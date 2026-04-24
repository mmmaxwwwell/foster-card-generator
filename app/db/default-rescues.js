/**
 * Default rescue organizations seeded at install time and backfilled on startup.
 * Shared between the initial-schema migration (fresh install) and seeds.js (steady state).
 */

const DEFAULT_RESCUES = [
    {
        id: 1,
        name: 'Paws Rescue League',
        website: 'pawsrescueleague.org',
        logo_path: 'logo.png',
        logo_url: 'https://www.pawsrescueleague.org/uploads/1/3/6/2/136274550/prl-logo-white-background_orig.png',
        logo_mime: 'image/png',
        org_id: '1841035',
        scraper_type: 'wagtopia'
    },
    {
        id: 2,
        name: 'Brass City Rescue',
        website: 'brasscityrescuealliance.org',
        logo_path: 'brass-city-logo.jpg',
        // Origin URL is Cloudflare-challenged; fetch from the Wayback Machine snapshot instead.
        logo_url: 'https://web.archive.org/web/2024if_/https://www.brasscityrescuealliance.org/wp-content/uploads/2020/02/42461358_959950707545036_5723441863524876288_n.jpg',
        logo_mime: 'image/jpeg',
        org_id: '87063',
        scraper_type: 'adoptapet'
    }
];

module.exports = { DEFAULT_RESCUES };
