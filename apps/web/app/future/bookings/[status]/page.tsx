import { withAppDirSsg } from "app/WithAppDirSsg";
import { _generateMetadata } from "app/_utils";
import { WithLayout } from "app/layoutHOC";
import type { InferGetStaticPropsType } from "next";

import { validStatuses } from "~/bookings/lib/validStatuses";
import Page from "~/bookings/views/bookings-listing-view";
import { getStaticProps } from "~/bookings/views/bookings-listing-view.getStaticProps";

type Y = InferGetStaticPropsType<typeof getStaticProps>;
const getData = withAppDirSsg<Y>(getStaticProps);

export const generateMetadata = async () =>
  await _generateMetadata(
    () => "Bookings",
    () => "Create events to share for people to book on your calendar."
  );

export const generateStaticParams = async () => {
  return validStatuses.map((status) => ({ status }));
};

export default WithLayout({ getLayout: null, getData, Page })<"P">;

export const dynamic = "force-static";
