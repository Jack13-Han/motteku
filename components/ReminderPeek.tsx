'use client';
import { ArrowRight, Bell, CalendarDays, Clock3 } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';

type Props={tripName:string;startDate:string;prepStartDate?:string;onOpen:()=>void};
export default function ReminderPeek({tripName,startDate,prepStartDate,onOpen}:Props){
 const {t,date}=useLanguage();
 const today=localDate(new Date());
 const reminders=[
  {date:prepStartDate||startDate,label:t('Preparation starts')},
  {date:shiftDay(startDate,-1),label:t('Day before departure')},
  {date:startDate,label:t('Trip departure')},
 ].filter(item=>item.date>=today).sort((a,b)=>a.date.localeCompare(b.date));
 const next=reminders[0];
 return <section className="reminder-peek" aria-label={t('Next reminder')}>
  <div className="reminder-peek-icon"><CalendarDays size={20}/></div>
  <div className="reminder-peek-copy"><small>{t('Next reminder')} · {tripName}</small>{next?<><b>{next.label}</b><span><Clock3 size={13}/>{date(next.date)}{reminders.length>1&&<em>{t('{count} more',{count:reminders.length-1})}</em>}</span></>:<b>{t('No upcoming reminders. This trip has already started or ended.')}</b>}</div>
  <button type="button" onClick={onOpen}>{t('View reminders')}<ArrowRight size={15}/></button>
  <Bell className="reminder-peek-watermark" size={72}/>
 </section>;
}
function localDate(d:Date){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`}
function shiftDay(day:string,n:number){const d=new Date(`${day}T12:00:00`);d.setDate(d.getDate()+n);return localDate(d)}
