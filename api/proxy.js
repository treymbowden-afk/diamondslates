// DiamondSlates data proxy
// ---------------------------------------------------------------
// Browsers block websites from fetching data directly from some
// services (Open-Meteo weather, Baseball Savant Statcast). This
// function runs on Vercel's servers — server-to-server requests
// aren't subject to that browser restriction, so the data flows
// through cleanly. The frontend calls /api/proxy?type=...&...
// instead of hitting those services directly.

export default async function handler(req, res) {
  // Allow our own pages to call this function
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { type } = req.query;

  try {
    let upstreamUrl;
    let isCsv = false;

    if (type === 'weather') {
      // Weather for one stadium: ?type=weather&lat=..&lon=..
      const { lat, lon } = req.query;
      if (!lat || !lon) return res.status(400).json({ error: 'Missing lat/lon' });
      upstreamUrl =
        `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}` +
        `&longitude=${encodeURIComponent(lon)}` +
        `&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m` +
        `&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=1`;

    } else if (type === 'arsenal') {
      // Pitch arsenal CSV from Baseball Savant: ?type=arsenal&year=2025
      const year = req.query.year || '2025';
      upstreamUrl =
        `https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats` +
        `?type=pitcher&pitchType=&year=${encodeURIComponent(year)}&team=&min=1&csv=true`;
      isCsv = true;

    } else if (type === 'expected') {
      // Expected stats CSV from Baseball Savant: ?type=expected&playerType=pitcher|batter&year=2025
      const year = req.query.year || '2025';
      const playerType = req.query.playerType === 'batter' ? 'batter' : 'pitcher';
      upstreamUrl =
        `https://baseballsavant.mlb.com/leaderboard/expected_statistics` +
        `?type=${playerType}&year=${encodeURIComponent(year)}&position=&team=&min=1&csv=true`;
      isCsv = true;

    } else if (type === 'exitvelo') {
      // Exit Velocity & Barrels CSV: ?type=exitvelo&playerType=pitcher|batter&year=2025
      // Adds: avg/max exit velocity, hard-hit %, barrel %, launch angle
      const year = req.query.year || '2025';
      const playerType = req.query.playerType === 'batter' ? 'batter' : 'pitcher';
      upstreamUrl =
        `https://baseballsavant.mlb.com/leaderboard/statcast` +
        `?type=${playerType}&year=${encodeURIComponent(year)}&position=&team=&min=1&csv=true`;
      isCsv = true;

    } else {
      return res.status(400).json({ error: 'Unknown type' });
    }

    // Fetch from the upstream service, server-to-server
    const upstream = await fetch(upstreamUrl, {
      headers: {
        // Some services behave better with a browser-like user agent
        'User-Agent': 'Mozilla/5.0 (compatible; DiamondSlates/1.0)',
        'Accept': isCsv ? 'text/csv,*/*' : 'application/json',
      },
    });

    if (!upstream.ok) {
      return res.status(502).json({ error: `Upstream ${upstream.status}` });
    }

    if (isCsv) {
      const text = await upstream.text();
      // Cache CSV leaderboards for 1 hour (they update daily, not by the minute)
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.status(200).send(text);
    } else {
      const data = await upstream.json();
      // Cache weather for 5 minutes
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(200).json(data);
    }

  } catch (err) {
    return res.status(500).json({ error: 'Proxy failed', detail: String(err) });
  }
}
