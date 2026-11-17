# CCI Ottawa Giving Project

Church fundraising website with project pages, Tithely giving links, member payment reports, pledges, and a private finance dashboard.

## Run and build

Use Node 22 or newer.

    npm run build
    npm run dev

The connected preview runs at http://127.0.0.1:4174. Administrator entry: /admin/. The public website has no dashboard link.

Cloudflare Pages: build command `npm run build`, output directory `dist`. Pages compiles the API handlers under `functions/`. Connect this private GitHub repository to Pages for reviewed deployments. The custom domain can be added later.

## Configuration

See [SETUP.md](SETUP.md) and [.env.example](.env.example). Put local variables in ignored `.dev.vars`. Store production secret keys in Cloudflare's encrypted settings. No credentials or donor records belong in this repository. The public-only build copies an explicit 21-image manifest and excludes source setup scripts, credentials, screenshots, retired images and prompt provenance.

## Giving workflow

Members pay at https://give.tithe.ly/?formId=0aba42c7-48ae-4545-918c-f01132edbb79&locationId=b22badae-5974-47d8-a315-5e46d6389d13&fundId=c7fcb07f-9839-426c-a7b1-96a85a453368, return to submit a payment report, and receive a reference. Reports stay pending until church finance verifies the actual Tithely payment. Only approved payments increase public raised totals. Duplicate verified transaction references are blocked. Pledges are separate. Review changes are audited, and reversed gifts are removed from raised totals.

Administrator access is invitation-only and checked in the database. Public totals contain no donor information. The open `/#dashboard` route is an isolated demonstration using fictional records; it does not expose the private finance system.

## Projects and images

12 projects, total C$52,000. Prices cover the full quantity for each row; quantities are retained in project data but not displayed on cards. Church photographs were supplied by CCI Ottawa. Equipment images are AI-generated illustrations and may differ from exact product appearances. Logo: red symbol with black Ottawa lettering.

## Verification status

Supabase tables and 12 projects have been created. Database rollback tests passed for approval, duplicate-reference prevention and reversal; no test donations were retained. Anonymous access to donor reports is denied. Administrator account configured; browser sign-in, full website reporting, production Turnstile and deployment verification remain to be completed. Read SETUP.md before enabling real submissions.
