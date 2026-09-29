export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  const calendarId=process.env.GOOGLE_CALENDAR_ID;
  const apiKey=process.env.GOOGLE_CALENDAR_API_KEY;
  if(!calendarId||!apiKey) return res.status(503).json({error:"Calendar sync is not configured"});
  const now=new Date(), end=new Date(Date.now()+35*86400000);
  const params=new URLSearchParams({key:apiKey,timeMin:now.toISOString(),timeMax:end.toISOString(),singleEvents:"true",orderBy:"startTime",maxResults:"100",timeZone:"Europe/Stockholm"});
  try{
    const response=await fetch("https://www.googleapis.com/calendar/v3/calendars/"+encodeURIComponent(calendarId)+"/events?"+params);
    if(!response.ok) return res.status(response.status).json({error:"Calendar request failed"});
    const data=await response.json();
    const events=(data.items||[]).filter(e=>e.status!=="cancelled").map(e=>({id:e.id,title:e.summary||"Kalenderhändelse",start:e.start?.dateTime||e.start?.date,end:e.end?.dateTime||e.end?.date,location:e.location||"",allDay:!!e.start?.date}));
    res.status(200).json({events});
  }catch(e){res.status(500).json({error:"Calendar sync failed"});}
}