import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { JSDOM } from "jsdom";
import { uuid } from "short-uuid";

import { getOrgUsernameFromEmail } from "@calcom/features/auth/signup/utils/getOrgUsernameFromEmail";
import { WEBAPP_URL } from "@calcom/lib/constants";
import { MembershipRole, SchedulingType } from "@calcom/prisma/enums";

import { test } from "../lib/fixtures";
import {
  bookTimeSlot,
  doOnOrgDomain,
  selectFirstAvailableTimeSlotNextMonth,
  submitAndWaitForResponse,
  testName,
} from "../lib/testUtils";
import { expectExistingUserToBeInvitedToOrganization } from "../team/expects";
import { gotoPathAndExpectRedirectToOrgDomain } from "./lib/gotoPathAndExpectRedirectToOrgDomain";
import { acceptTeamOrOrgInvite, inviteExistingUserToOrganization } from "./lib/inviteUser";

function getOrgOrigin(orgSlug: string | null) {
  if (!orgSlug) {
    throw new Error("orgSlug is required");
  }

  let orgOrigin = WEBAPP_URL.replace("://app", `://${orgSlug}`);
  orgOrigin = orgOrigin.includes(orgSlug) ? orgOrigin : WEBAPP_URL.replace("://", `://${orgSlug}.`);
  return orgOrigin;
}

test.describe("Bookings", () => {
  test.afterEach(async ({ orgs, users, page }) => {
    await users.deleteAll();
    await orgs.deleteAll();
  });

  test.describe("Team Event", () => {
    test("Can create a booking for Collective EventType", async ({ page, users, orgs }) => {
      const org = await orgs.create({
        name: "TestOrg",
      });
      const teamMatesObj = [
        { name: "teammate-1" },
        { name: "teammate-2" },
        { name: "teammate-3" },
        { name: "teammate-4" },
      ];

      const owner = await users.create(
        {
          username: "pro-user",
          name: "pro-user",
          organizationId: org.id,
          roleInOrganization: MembershipRole.MEMBER,
        },
        {
          hasTeam: true,
          teammates: teamMatesObj,
          schedulingType: SchedulingType.COLLECTIVE,
        }
      );
      const { team } = await owner.getFirstTeamMembership();
      const teamEvent = await owner.getFirstTeamEvent(team.id);

      await expectPageToBeNotFound({ page, url: `/team/${team.slug}/${teamEvent.slug}` });
      await doOnOrgDomain(
        {
          orgSlug: org.slug,
          page,
        },
        async () => {
          await bookTeamEvent({ page, team, event: teamEvent });
          // All the teammates should be in the booking
          for (const teammate of teamMatesObj.concat([{ name: owner.name || "" }])) {
            await expect(page.getByText(teammate.name, { exact: true })).toBeVisible();
          }
        }
      );

      // TODO: Assert whether the user received an email
    });

    test("Can create a booking for Collective EventType with only phone number", async ({
      page,
      users,
      orgs,
    }) => {
      const org = await orgs.create({
        name: "TestOrg",
      });
      const teamMatesObj = [
        { name: "teammate-1" },
        { name: "teammate-2" },
        { name: "teammate-3" },
        { name: "teammate-4" },
      ];

      const owner = await users.create(
        {
          username: "pro-user",
          name: "pro-user",
          organizationId: org.id,
          roleInOrganization: MembershipRole.MEMBER,
        },
        {
          hasTeam: true,
          teammates: teamMatesObj,
          schedulingType: SchedulingType.COLLECTIVE,
        }
      );
      const { team } = await owner.getFirstTeamMembership();
      const teamEvent = await owner.getFirstTeamEvent(team.id);
      await owner.apiLogin();

      await markPhoneNumberAsRequiredAndEmailAsOptional(page, teamEvent.id);

      await expectPageToBeNotFound({ page, url: `/team/${team.slug}/${teamEvent.slug}` });
      await doOnOrgDomain(
        {
          orgSlug: org.slug,
          page,
        },
        async () => {
          await bookTeamEvent({
            page,
            team,
            event: teamEvent,
            opts: { attendeePhoneNumber: "+918888888888" },
          });
          // All the teammates should be in the booking
          for (const teammate of teamMatesObj.concat([{ name: owner.name || "" }])) {
            await expect(page.getByText(teammate.name, { exact: true })).toBeVisible();
          }
        }
      );

      // TODO: Assert whether the user received an email
    });

    test("Can create a booking for Round Robin EventType", async ({ page, users, orgs }) => {
      const org = await orgs.create({
        name: "TestOrg",
      });
      const teamMatesObj = [
        { name: "teammate-1" },
        { name: "teammate-2" },
        { name: "teammate-3" },
        { name: "teammate-4" },
      ];
      const owner = await users.create(
        {
          username: "pro-user",
          name: "pro-user",
          organizationId: org.id,
          roleInOrganization: MembershipRole.MEMBER,
        },
        {
          hasTeam: true,
          teammates: teamMatesObj,
          schedulingType: SchedulingType.ROUND_ROBIN,
        }
      );

      const { team } = await owner.getFirstTeamMembership();
      const teamEvent = await owner.getFirstTeamEvent(team.id);
      const eventHostsObj = [...teamMatesObj, { name: "pro-user" }];

      await expectPageToBeNotFound({ page, url: `/team/${team.slug}/${teamEvent.slug}` });

      await doOnOrgDomain(
        {
          orgSlug: org.slug,
          page,
        },
        async () => {
          await bookTeamEvent({ page, team, event: teamEvent, teamMatesObj: eventHostsObj });

          // Since all the users have the same leastRecentlyBooked value
          // Anyone of the teammates could be the Host of the booking.
          const chosenUser = await page.getByTestId("booking-host-name").textContent();
          expect(chosenUser).not.toBeNull();
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          expect(teamMatesObj.concat([{ name: owner.name! }]).some(({ name }) => name === chosenUser)).toBe(
            true
          );
        }
      );
      // TODO: Assert whether the user received an email
    });

    test("Can create a booking for Round Robin EventType with both phone number and email required", async ({
      page,
      users,
      orgs,
    }) => {
      const org = await orgs.create({
        name: "TestOrg",
      });
      const teamMatesObj = [
        { name: "teammate-1" },
        { name: "teammate-2" },
        { name: "teammate-3" },
        { name: "teammate-4" },
      ];
      const owner = await users.create(
        {
          username: "pro-user",
          name: "pro-user",
          organizationId: org.id,
          roleInOrganization: MembershipRole.MEMBER,
        },
        {
          hasTeam: true,
          teammates: teamMatesObj,
          schedulingType: SchedulingType.ROUND_ROBIN,
        }
      );

      const { team } = await owner.getFirstTeamMembership();
      const teamEvent = await owner.getFirstTeamEvent(team.id);
      await owner.apiLogin();

      await markPhoneNumberAsRequiredField(page, teamEvent.id);

      await expectPageToBeNotFound({ page, url: `/team/${team.slug}/${teamEvent.slug}` });

      await doOnOrgDomain(
        {
          orgSlug: org.slug,
          page,
        },
        async () => {
          await bookTeamEvent({
            page,
            team,
            event: teamEvent,
            teamMatesObj,
            opts: { attendeePhoneNumber: "+918888888888" },
          });

          // Since all the users have the same leastRecentlyBooked value
          // Anyone of the teammates could be the Host of the booking.
          const chosenUser = await page.getByTestId("booking-host-name").textContent();
          expect(chosenUser).not.toBeNull();
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          expect(teamMatesObj.concat([{ name: owner.name! }]).some(({ name }) => name === chosenUser)).toBe(
            true
          );
        }
      );
      // TODO: Assert whether the user received an email
    });

    test("Can access booking page with event slug and team page in lowercase/uppercase/mixedcase", async ({
      page,
      orgs,
      users,
    }) => {
      const org = await orgs.create({
        name: "TestOrg",
      });
      const teamMatesObj = [
        { name: "teammate-1" },
        { name: "teammate-2" },
        { name: "teammate-3" },
        { name: "teammate-4" },
      ];

      const owner = await users.create(
        {
          username: "pro-user",
          name: "pro-user",
          organizationId: org.id,
          roleInOrganization: MembershipRole.MEMBER,
        },
        {
          hasTeam: true,
          teammates: teamMatesObj,
          schedulingType: SchedulingType.COLLECTIVE,
        }
      );
      const { team } = await owner.getFirstTeamMembership();
      const { slug: teamEventSlug } = await owner.getFirstTeamEvent(team.id);

      const teamSlugUpperCase = team.slug?.toUpperCase();
      const teamEventSlugUpperCase = teamEventSlug.toUpperCase();

      // This is the most closest to the actual user flow as org1.cal.com maps to /org/orgSlug
      await page.goto(`/org/${org.slug}/${teamSlugUpperCase}/${teamEventSlugUpperCase}`);
      await page.waitForSelector("[data-testid=day]");
    });
  });

  test.describe("User Event", () => {
    test("Can create a booking", async ({ page, users, orgs }) => {
      const org = await orgs.create({
        name: "TestOrg",
      });

      const user = await users.create({
        username: "pro-user",
        name: "pro-user",
        organizationId: org.id,
        roleInOrganization: MembershipRole.MEMBER,
      });

      const event = await user.getFirstEventAsOwner();
      await expectPageToBeNotFound({ page, url: `/${user.username}/${event.slug}` });

      await doOnOrgDomain(
        {
          orgSlug: org.slug,
          page,
        },
        async () => {
          await bookUserEvent({ page, user, event });
        }
      );
    });

    test.describe("User Event with same slug as another user's", () => {
      test("booking is created for first user when first user is booked", async ({ page, users, orgs }) => {
        const org = await orgs.create({
          name: "TestOrg",
        });

        const user1 = await users.create({
          username: "user1",
          name: "User 1",
          organizationId: org.id,
          roleInOrganization: MembershipRole.MEMBER,
        });

        const user2 = await users.create({
          username: "user2",
          name: "User2",
          organizationId: org.id,
          roleInOrganization: MembershipRole.MEMBER,
        });

        const user1Event = await user1.getFirstEventAsOwner();

        await doOnOrgDomain(
          {
            orgSlug: org.slug,
            page,
          },
          async () => {
            await bookUserEvent({ page, user: user1, event: user1Event });
          }
        );
      });
      test("booking is created for second user when second user is booked", async ({ page, users, orgs }) => {
        const org = await orgs.create({
          name: "TestOrg",
        });

        const user1 = await users.create({
          username: "user1",
          name: "User 1",
          organizationId: org.id,
          roleInOrganization: MembershipRole.MEMBER,
        });

        const user2 = await users.create({
          username: "user2",
          name: "User2",
          organizationId: org.id,
          roleInOrganization: MembershipRole.MEMBER,
        });

        const user2Event = await user2.getFirstEventAsOwner();

        await doOnOrgDomain(
          {
            orgSlug: org.slug,
            page,
          },
          async () => {
            await bookUserEvent({ page, user: user2, event: user2Event });
          }
        );
      });
    });

    test("check SSR and OG ", async ({ page, users, orgs }) => {
      const name = "Test User";
      const org = await orgs.create({
        name: "TestOrg",
      });

      const user = await users.create({
        name,
        organizationId: org.id,
        roleInOrganization: MembershipRole.MEMBER,
      });

      const firstEventType = await user.getFirstEventAsOwner();
      const calLink = `/${user.username}/${firstEventType.slug}`;
      await doOnOrgDomain(
        {
          orgSlug: org.slug,
          page,
        },
        async () => {
          const [response] = await Promise.all([
            // This promise resolves to the main resource response
            page.waitForResponse(
              (response) => response.url().includes(`${calLink}`) && response.status() === 200
            ),

            // Trigger the page navigation
            page.goto(`${calLink}`),
          ]);
          const ssrResponse = await response.text();
          const document = new JSDOM(ssrResponse).window.document;
          const orgOrigin = getOrgOrigin(org.slug);
          const titleText = document.querySelector("title")?.textContent;
          const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
          const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute("content");
          const canonicalLink = document.querySelector('link[rel="canonical"]')?.getAttribute("href");
          expect(titleText).toContain(name);
          expect(ogUrl).toEqual(`${orgOrigin}${calLink}`);
          expect(canonicalLink).toEqual(`${orgOrigin}${calLink}`);
          // Verify that there is correct URL that would generate the awesome OG image
          expect(ogImage).toContain(
            "/_next/image?w=1200&q=100&url=%2Fapi%2Fsocial%2Fog%2Fimage%3Ftype%3Dmeeting%26title%3D"
          );
          // Verify Organizer Name in the URL
          expect(ogImage).toContain("meetingProfileName%3DTest%2520User%26");
        }
      );
    });
  });

  test.describe("Scenario with same username in and outside organization", () => {
    test("Can create a booking for user with same username in and outside organization", async ({
      page,
      users,
      orgs,
    }) => {
      const org = await orgs.create({
        name: "TestOrg",
      });

      const username = "john";
      const userInsideOrganization = await users.create({
        username,
        useExactUsername: true,
        email: `john-inside-${uuid()}@example.com`,
        name: "John Inside Organization",
        organizationId: org.id,
        roleInOrganization: MembershipRole.MEMBER,
        eventTypes: [
          {
            title: "John Inside Org's Meeting",
            slug: "john-inside-org-meeting",
            length: 15,
          },
        ],
      });

      const userOutsideOrganization = await users.create({
        username,
        name: "John Outside Organization",
        email: `john-outside-${uuid()}@example.com`,
        useExactUsername: true,
        eventTypes: [
          {
            title: "John Outside Org's Meeting",
            slug: "john-outside-org-meeting",
            length: 15,
          },
        ],
      });

      const eventForUserInsideOrganization = await userInsideOrganization.getFirstEventAsOwner();
      const eventForUserOutsideOrganization = await userOutsideOrganization.getFirstEventAsOwner();

      // John Inside Org's meeting can't be accessed on userOutsideOrganization's namespace
      await expectPageToBeNotFound({
        page,
        url: `/${userOutsideOrganization.username}/john-inside-org-meeting`,
      });

      await bookUserEvent({ page, user: userOutsideOrganization, event: eventForUserOutsideOrganization });

      await doOnOrgDomain(
        {
          orgSlug: org.slug,
          page,
        },
        async () => {
          // John Outside Org's meeting can't be accessed on userInsideOrganization's namespaces
          await expectPageToBeNotFound({
            page,
            url: `/${userInsideOrganization.username}/john-outside-org-meeting`,
          });
          await bookUserEvent({ page, user: userInsideOrganization, event: eventForUserInsideOrganization });
        }
      );
    });
  });

  test.describe("Inviting an existing user and then", () => {
    test("create a booking on new link", async ({ page, browser, users, orgs, emails }) => {
      const org = await orgs.create({
        name: "TestOrg",
      });

      const owner = await users.create({
        username: "owner",
        name: "owner",
        organizationId: org.id,
        roleInOrganization: MembershipRole.OWNER,
      });

      const userOutsideOrganization = await users.create({
        username: "john",
        name: "John Outside Organization",
      });

      await owner.apiLogin();

      const { invitedUserEmail } = await inviteExistingUserToOrganization({
        page,
        organizationId: org.id,
        user: userOutsideOrganization,
        usersFixture: users,
      });

      const inviteLink = await expectExistingUserToBeInvitedToOrganization(page, emails, invitedUserEmail);
      if (!inviteLink) {
        throw new Error("Invite link not found");
      }
      const usernameInOrg = getOrgUsernameFromEmail(
        invitedUserEmail,
        org.organizationSettings?.orgAutoAcceptEmail ?? null
      );

      const usernameOutsideOrg = userOutsideOrganization.username;
      // Before invite is accepted the booking page isn't available
      await expectPageToBeNotFound({ page, url: `/${usernameInOrg}` });
      const [newContext, newPage] = await userOutsideOrganization.apiLoginOnNewBrowser(browser);
      await acceptTeamOrOrgInvite(newPage);
      await newContext.close();
      await test.step("Book through new link", async () => {
        await doOnOrgDomain(
          {
            orgSlug: org.slug,
            page,
          },
          async () => {
            await bookUserEvent({
              page,
              user: {
                username: usernameInOrg,
                name: userOutsideOrganization.name,
              },
              event: await userOutsideOrganization.getFirstEventAsOwner(),
            });
          }
        );
      });

      await test.step("Booking through old link redirects to new link on org domain", async () => {
        const event = await userOutsideOrganization.getFirstEventAsOwner();
        await gotoPathAndExpectRedirectToOrgDomain({
          page,
          org,
          path: `/${usernameOutsideOrg}/${event.slug}`,
          expectedPath: `/${usernameInOrg}/${event.slug}`,
        });
        // As the redirection correctly happens, the booking would work too which we have verified in previous step. But we can't test that with org domain as that domain doesn't exist.
      });
    });
  });
});

async function bookUserEvent({
  page,
  user,
  event,
}: {
  page: Page;
  user: {
    username: string | null;
    name: string | null;
  };
  event: { slug: string; title: string };
}) {
  await page.goto(`/${user.username}/${event.slug}`);

  await selectFirstAvailableTimeSlotNextMonth(page);
  await bookTimeSlot(page);
  await expect(page.getByTestId("success-page")).toBeVisible();

  // The title of the booking
  const BookingTitle = `${event.title} between ${user.name} and ${testName}`;
  await expect(page.getByTestId("booking-title")).toHaveText(BookingTitle);
  // The booker should be in the attendee list
  await expect(page.getByTestId(`attendee-name-${testName}`)).toHaveText(testName);
}

async function bookTeamEvent({
  page,
  team,
  event,
  teamMatesObj,
  opts,
}: {
  page: Page;
  team: {
    slug: string | null;
    name: string | null;
  };
  event: { slug: string; title: string; schedulingType: SchedulingType | null };
  teamMatesObj?: { name: string }[];
  opts?: { attendeePhoneNumber?: string };
}) {
  // Note that even though the default way to access a team booking in an organization is to not use /team in the URL, but it isn't testable with playwright as the rewrite is taken care of by Next.js config which can't handle on the fly org slug's handling
  // So, we are using /team in the URL to access the team booking
  // There are separate tests to verify that the next.config.js rewrites are working
  // Also there are additional checkly tests that verify absolute e2e flow. They are in __checks__/organization.spec.ts
  await page.goto(`/team/${team.slug}/${event.slug}`);

  await selectFirstAvailableTimeSlotNextMonth(page);
  await bookTimeSlot(page, opts);
  await expect(page.getByTestId("success-page")).toBeVisible();

  // The title of the booking
  if (event.schedulingType === SchedulingType.ROUND_ROBIN && teamMatesObj) {
    const bookingTitle = await page.getByTestId("booking-title").textContent();

    const isMatch = teamMatesObj?.some((teamMate) => {
      const expectedTitle = `${event.title} between ${teamMate.name} and ${testName}`;
      return expectedTitle.trim() === bookingTitle?.trim();
    });

    expect(isMatch).toBe(true);
  } else {
    const BookingTitle = `${event.title} between ${team.name} and ${testName}`;
    await expect(page.getByTestId("booking-title")).toHaveText(BookingTitle);
  }
  // The booker should be in the attendee list
  await expect(page.getByTestId(`attendee-name-${testName}`)).toHaveText(testName);
}

async function expectPageToBeNotFound({ page, url }: { page: Page; url: string }) {
  await page.goto(`${url}`);
  await expect(page.getByTestId(`404-page`)).toBeVisible();
}

const markPhoneNumberAsRequiredAndEmailAsOptional = async (page: Page, eventId: number) => {
  // Make phone as required
  await markPhoneNumberAsRequiredField(page, eventId);

  // Make email as not required
  await page.locator('[data-testid="field-email"] [data-testid="edit-field-action"]').click();
  const emailRequiredFiled = await page.locator('[data-testid="field-required"]');
  await emailRequiredFiled.locator("> :nth-child(2)").click();
  await page.getByTestId("field-add-save").click();
  await submitAndWaitForResponse(page, "/api/trpc/eventTypes/update?batch=1", {
    action: () => page.locator("[data-testid=update-eventtype]").click(),
  });
};

const markPhoneNumberAsRequiredField = async (page: Page, eventId: number) => {
  await page.goto(`/event-types/${eventId}?tabName=advanced`);

  await page.locator('[data-testid="field-attendeePhoneNumber"] [data-testid="toggle-field"]').click();
  await page.locator('[data-testid="field-attendeePhoneNumber"] [data-testid="edit-field-action"]').click();
  const phoneRequiredFiled = await page.locator('[data-testid="field-required"]');
  await phoneRequiredFiled.locator("> :nth-child(1)").click();
  await page.getByTestId("field-add-save").click();
  await submitAndWaitForResponse(page, "/api/trpc/eventTypes/update?batch=1", {
    action: () => page.locator("[data-testid=update-eventtype]").click(),
  });
};
