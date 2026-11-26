import Script from "next/script";

/**
 * Optional, cookieless page analytics. Nothing loads unless one of these is set:
 * - Umami (free tier at cloud.umami.is): NEXT_PUBLIC_UMAMI_WEBSITE_ID, optional NEXT_PUBLIC_UMAMI_SRC for self-hosted.
 * - Plausible: NEXT_PUBLIC_PLAUSIBLE_DOMAIN (e.g. stockport.xyz).
 * Both count visits without cookies or personal data, so no cookie banner is needed. See /privacy.
 */
export default function Analytics() {
  const umamiId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  const umamiSrc = process.env.NEXT_PUBLIC_UMAMI_SRC || "https://cloud.umami.is/script.js";
  const plausible = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  return (
    <>
      {umamiId && <Script src={umamiSrc} data-website-id={umamiId} strategy="afterInteractive" />}
      {plausible && <Script src="https://plausible.io/js/script.js" data-domain={plausible} strategy="afterInteractive" />}
    </>
  );
}
