'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Bell, BriefcaseBusiness, CalendarDays, Check, Clock3, MapPin } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import { reminderDay, tripReminders, validReminderDate } from '@/lib/reminders';

export default function PrepReminders({tripName,startDate,prepStartDate,memberCount,onPrepDate,onNotice}:{tripName:string;startDate:string;prepStartDate?:string;memberCount:number;onPrepDate:(date:string)=>void;onNotice:(message:string)=>void}){
 const {t,date}=useLanguage();
 const [permission,setPermission]=useState('default');
 const [now,setNow]=useState(new Date());
 const dateInput=useRef<HTMLInputElement>(null);
 useEffect(()=>{if('Notification'in window)setPermission(Notification.permission);const timer=window.setInterval(()=>setNow(new Date()),60000);return()=>clearInterval(timer)},[]);
 const reminders=useMemo(()=>tripReminders(startDate,prepStartDate).map(reminder=>({...reminder,label:t(reminder.title),detail:t(reminder.detail)})),[prepStartDate,startDate,t]);
 const enable=async()=>{if(!('Notification'in window)){onNotice('This browser does not support notifications.');return}try{const result=await Notification.requestPermission();setPermission(result);onNotice(result==='granted'?'Notifications enabled. Keep Motteku open to receive reminders.':'Notification permission was not granted.');}catch{onNotice('Notification permission was not granted.')}};
 const today=reminderDay(now);
 const upcoming=reminders.filter(reminder=>reminder.date>=today);
 const grouped=upcoming.reduce<{date:string;items:typeof reminders}[]>((groups,reminder)=>{const last=groups[groups.length-1];if(last?.date===reminder.date)last.items.push(reminder);else groups.push({date:reminder.date,items:[reminder]});return groups},[]);
 const permissionDenied=permission==='denied';
 return <div className="prep-page">
  <section className="panel page-panel prep-reminders">
   <div className="panel-head"><div><h3><Bell size={17}/> {t('Preparation reminders')}</h3><p>{t('Set when your group starts preparing for the trip.')}</p></div><CalendarDays className="muted-icon"/></div>
   <div className="prep-trip-summary"><div className="prep-trip-art"><span className="prep-trip-sun"/><MapPin className="prep-trip-pin" size={17}/><BriefcaseBusiness className="prep-trip-bag" size={34}/><span className="prep-trip-ground"/></div><div className="prep-trip-copy"><span>{t('Trip')}: <b>{tripName}</b></span><small>{t('A group trip with {count} members',{count:memberCount})}<CalendarDays size={13}/></small></div><label className="prep-date-field">{t('Start preparing on')}<input ref={dateInput} type="date" max={validReminderDate(startDate)?startDate:undefined} disabled={!validReminderDate(startDate)} value={reminders.find(reminder=>reminder.id==='prep')?.date||''} onChange={e=>onPrepDate(e.target.value)}/></label></div>
   <div className={`prep-notification-status ${permission==='granted'?'enabled':''} ${permissionDenied?'blocked':''}`}><div className="prep-status-copy"><span className="prep-status-icon">{permission==='granted'?<Check size={16}/>:<Bell size={16}/>}</span><div><b>{t(permission==='granted'?'Browser notifications enabled':permissionDenied?'Notifications blocked in browser':'Enable browser notifications')}</b><small>{t(permission==='granted'?'Browser notifications may appear while Motteku is open.':permissionDenied?'Notifications are blocked. Change this site’s notification permission in your browser settings, then reload.':'Browser notifications may appear while Motteku is open.')}</small></div></div>{permissionDenied?<span className="prep-permission-badge">{t('Blocked')}</span>:<button className={permission==='granted'?'soft-button':'primary'} onClick={enable} disabled={permission==='granted'}>{t(permission==='granted'?'Browser notifications enabled':'Enable browser notifications')}</button>}</div>
  </section>
  <section className="panel prep-upcoming-panel">
   <div className="prep-schedule-heading"><div><h3>{t('Upcoming reminders')}</h3><p>{t('Your trip schedule')}</p></div>{upcoming.length>0&&<span><Clock3 size={14}/>{upcoming.length}</span>}</div>
   {grouped.length>0?<div className="prep-timeline">{grouped.map(group=><div className={`prep-date-group${group.date===today?' today':''}`} key={group.date}><div className="prep-date-marker"><time>{date(group.date)}</time><span/></div><div className="prep-date-events">{group.items.map(reminder=><article className="prep-event" key={reminder.id}><div><b>{reminder.label}</b><small>{reminder.detail}</small></div></article>)}</div></div>)}</div>:<div className="prep-empty-state"><div className="prep-empty-art" aria-hidden="true"><div className="prep-empty-calendar"><CalendarDays size={27}/></div><div className="prep-empty-suitcase"><BriefcaseBusiness size={43}/></div><span className="prep-empty-bell"><Bell size={22}/></span><i/><i/><i/></div><p>{t(validReminderDate(startDate)?'No upcoming reminders. This trip has already started or ended.':'Travel dates are needed before reminders can be scheduled.')}</p></div>}
   <button type="button" className="prep-adjust-button" disabled={!validReminderDate(startDate)} onClick={()=>{dateInput.current?.focus();dateInput.current?.click()}}>{t('Adjust start date')}<ArrowRight size={14}/></button>
  </section>
 </div>
}
