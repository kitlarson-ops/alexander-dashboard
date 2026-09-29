export default function handler(req,res){
 const id=process.env.GOOGLE_CLIENT_ID;
 if(!id)return res.status(503).send("OAuth not configured");
 const p=new URLSearchParams();
 p.set("client_id",id);p.set("redirect_uri","https://alexander-dashboard.vercel.app/api/oauth/callback");
 p.set("response_type","code");p.set("scope","https://www.googleapis.com/auth/calendar.readonly");
 p.set("access_type","offline");p.set("prompt","consent");
 res.redirect("https://accounts.google.com/o/oauth2/v2/auth?"+p.toString());
}