export default async function handler(req,res){
 res.setHeader("Cache-Control","no-store");
 const cid=process.env.GOOGLE_CLIENT_ID,sec=process.env.GOOGLE_CLIENT_SECRET,surl=process.env.SUPABASE_URL,skey=process.env.SUPABASE_SECRET_KEY;
 if(!cid||!sec||!surl||!skey)return res.status(503).json({error:"Server configuration missing"});
 const dr=await fetch(surl+"/rest/v1/google_oauth_tokens?id=eq.alexander&select=refresh_token",{headers:{apikey:skey,authorization:"Bearer "+skey}});
 const rows=await dr.json();if(!dr.ok||!rows[0])return res.status(401).json({error:"Calendar not connected",connect:"/api/oauth/start"});
 const tb=new URLSearchParams({client_id:cid,client_secret:sec,refresh_token:rows[0].refresh_token,grant_type:"refresh_token"});
 const tr=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:tb});
 const tok=await tr.json();if(!tr.ok)return res.status(401).json({error:"Google token refresh failed"});
 const now=new Date(),end=new Date(Date.now()+35*86400000);
 const qp=new URLSearchParams({timeMin:now.toISOString(),timeMax:end.toISOString(),singleEvents:"true",orderBy:"startTime",maxResults:"100",timeZone:"Europe/Stockholm"});
 const gr=await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?"+qp,{headers:{authorization:"Bearer "+tok.access_token}});
 const data=await gr.json();if(!gr.ok)return res.status(gr.status).json({error:"Calendar request failed"});
 const events=(data.items||[]).filter(e=>e.status!=="cancelled").map(e=>({id:e.id,title:e.summary||"Kalenderhändelse",start:e.start?.dateTime||e.start?.date,end:e.end?.dateTime||e.end?.date,location:e.location||"",allDay:!!e.start?.date}));
 res.status(200).json({events});
}