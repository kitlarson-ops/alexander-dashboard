export default async function handler(req,res){
  const code=req.query.code;
  if(!code) return res.status(400).send("Missing authorization code");
  const clientId=process.env.GOOGLE_CLIENT_ID;
  const clientSecret=process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri="https://alexander-dashboard.vercel.app/api/oauth/callback";
  if(!clientId||!clientSecret) return res.status(503).send("OAuth credentials are not configured yet");
  const body=new URLSearchParams({code,client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri,grant_type:"authorization_code"});
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body});
  const data=await r.json();
  if(!r.ok) return res.status(400).json({error:"OAuth token exchange failed"});
  res.setHeader("Cache-Control","no-store");
  return res.status(200).send("Google Calendar authorization succeeded. Return to ChatGPT to finish setup.");
}