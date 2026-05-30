export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    if (!body || !body.videoId) return res.status(400).json({ error: 'Missing videoId' });

    const videoId = body.videoId;
    const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

    // Step 1: Get fresh visitorData + cookies from YouTube
    let cookies = '';
    let pageVisitorData = body.context?.client?.visitorData || '';

    try {
      const pageResp = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
        redirect: 'follow',
      });
      const setCookies = pageResp.headers.getSetCookie?.() || [];
      cookies = setCookies.map(c => c.split(';')[0]).join('; ');
      const pageText = await pageResp.text();
      const vdMatch = pageText.match(/"VISITOR_DATA"\s*:\s*"([^"]+)"/);
      if (vdMatch) pageVisitorData = vdMatch[1];
    } catch (e) { /* continue without cookies */ }

    // Step 2: Build innertube request
    const clientName = body.context?.client?.clientName || 'ANDROID_VR';
    const clientVersion = body.context?.client?.clientVersion || '1.60.19';

    function buildBody(cn, cv, vd, isAndroid) {
      const b = {
        videoId, contentCheckOk: true, racyCheckOk: true,
        context: { client: { clientName: cn, clientVersion: cv, hl: 'en', gl: 'US' } },
        playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } },
      };
      if (isAndroid) {
        b.context.client.androidSdkVersion = 30;
        b.context.client.osName = 'Android';
        b.context.client.osVersion = '14';
      }
      if (vd) b.context.client.visitorData = vd;
      return b;
    }

    const headers = {
      'Content-Type': 'application/json',
      'Origin': 'https://www.youtube.com',
      'User-Agent': UA,
    };
    if (cookies) headers['Cookie'] = cookies;

    // Step 3: Try primary client
    async function tryClient(cn, cv, apiKey, vd, isAndroid) {
      const url = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`;
      const r = await fetch(url, {
        method: 'POST', headers,
        body: JSON.stringify(buildBody(cn, cv, vd, isAndroid)),
      });
      return r.json();
    }

    // Try ANDROID_VR first
    let data = await tryClient(clientName, clientVersion,
      'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w', pageVisitorData, true);

    let sd = data?.streamingData;
    let streamCount = (sd?.adaptiveFormats?.length || 0) + (sd?.formats?.length || 0);

    // Step 4: If no streams, try WEB + visitorData
    if (streamCount === 0) {
      try {
        const data2 = await tryClient('WEB', '2.20241126.01.00',
          'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', pageVisitorData, false);
        const sd2 = data2?.streamingData;
        const sc2 = (sd2?.adaptiveFormats?.length || 0) + (sd2?.formats?.length || 0);
        if (sc2 > streamCount) { data = data2; streamCount = sc2; }
      } catch (e) { /* use primary response */ }
    }

    // Step 5: If still no streams, try without visitorData (bare request)
    if (streamCount === 0 && pageVisitorData) {
      try {
        const data3 = await tryClient(clientName, clientVersion,
          'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w', '', true);
        const sd3 = data3?.streamingData;
        const sc3 = (sd3?.adaptiveFormats?.length || 0) + (sd3?.formats?.length || 0);
        if (sc3 > streamCount) { data = data3; streamCount = sc3; }
      } catch (e) { /* use primary response */ }
    }

    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
