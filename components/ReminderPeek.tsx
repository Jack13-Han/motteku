'use client';
import { useEffect, useState } from 'react';
import { ArrowRight, Bell, CalendarDays, Clock3 } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import { reminderDay, tripReminders, validReminderDate } from '@/lib/reminders';

type Props={tripName:string;startDate:string;prepStartDate?:string;onOpen:()=>void};
export default function ReminderPeek({tripName,startDate,prepStartDate,onOpen}:Props){
 const {t,date}=useLanguage();
 const [now,setNow]=useState(()=>new Date());
 useEffect(()=>{const timer=window.setInterval(()=>setNow(new Date()),60000);return()=>clearInterval(timer)},[]);
 const today=reminderDay(now);
 const reminders=tripReminders(startDate,prepStartDate).filter(item=>item.date>=today);
 const next=reminders[0];
 return <section className="reminder-peek" aria-label={t('Next reminder')}>
  <div className="reminder-peek-icon"><CalendarDays size={20}/></div>
  <div className="reminder-peek-copy"><small>{t('Next reminder')} · {tripName}</small>{next?<><b>{t(next.title)}</b><span><Clock3 size={13}/>{date(next.date)}{reminders.length>1&&<em>{t('{count} more',{count:reminders.length-1})}</em>}</span></>:<b>{t(validReminderDate(startDate)?'No upcoming reminders. This trip has already started or ended.':'Travel dates are needed before reminders can be scheduled.')}</b>}</div>
  <button type="button" onClick={onOpen}>{t('View reminders')}<ArrowRight size={15}/></button>
  <Bell className="reminder-peek-watermark" size={72}/>
 </section>;
}
