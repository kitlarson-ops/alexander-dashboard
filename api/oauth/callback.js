export default async function handler(req,res){
 const code=req.query.code;if(!code)return res.status(400).send("Missing authorization code");
 const cid=process.env.GOOGLE_CLIENT_ID,sec=process.env.GOOGLE_CLIENT_SECRET,surl=process.env.SUPABASE_URL,skey=process.env.SUPABASE_SECRET_KEY;
 if(!cid||!sec||!surl||!skey)return res.status(503).send("Server configuration missing");
 const body=new URLSearchParams({code,client_id:cid,client_secret:sec,redirect_uri:"https://alexander-dashboard.vercel.app/api/oauth/callback",grant_type:"authorization_code"});
 const tr=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body});
 const tok=await tr.json();if(!tr.ok||!tok.refresh_token)return res.status(400).send("Google authorization failed");
 const db=await fetch(surl+"/rest/v1/google_oauth_tokens?on_conflict=id",{method:"POST",headers:{apikey:skey,authorization:"Bearer "+skey,"content-type":"application/json",prefer:"resolution=merge-duplicates"},body:JSON.stringify({id:"alexander",refresh_token:tok.refresh_token,updated_at:new Date().toISOString()})});
 if(!db.ok)return res.status(500).send("Secure token storage failed");
 res.redirect("/?calendar=connected");
}