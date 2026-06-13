/* ------------------------------------------------------------
   App configuration.

   MOCK = true  -> standalone mode: no server, no database, no login.
                   Data lives in localStorage (see src/mock/), seeded with
                   demo data. Every screen works offline. Use this while
                   building out frontend features.

   MOCK = false -> talks to the real Express API (server/) backed by
                   PostgreSQL, with login + the database. This is what makes
                   data persist and stay in sync across devices/branches.

   The mock mirrors the server's exact response shapes, so switching is just
   an environment flag — no code change.

   Driven by VITE_MOCK:
     - `npm run dev`   -> no flag set -> MOCK = true  (offline, no server)
     - `npm run build` -> .env.production sets VITE_MOCK=false -> live database
   Override anytime, e.g. run dev against the real DB:  VITE_MOCK=false npm run dev
   ------------------------------------------------------------ */
export const MOCK = import.meta.env.VITE_MOCK !== "false";
