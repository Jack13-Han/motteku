'use client';
import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, X } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import { reminderDay, reminderNotificationKey, tripReminders, validReminderDate } from '@/lib/reminders';
import { useTravelCheckReminders } from '@/lib/useTravelCheckReminders';
import { checkProgress, checkpointTitle, travelReminderAt } from '@/lib/travelChecks';

type Trip = { id:string; name:string; startDate:string; prepStartDate?:string; sharedChatId?:string; items:{id:string;name:string;status:string;dueDate:string}[] };
type Notice = { id:string; tripId:string; title:string; detail:string; date:string; tab:string };
const dateKey=reminderDay;
export default function NotificationCenter({trips,accountId,onOpen}:{trips:Trip[];accountId:string;onOpen:(tripId:string,tab:string)=>void}) {
 const {t,date:formatDate}=useLanguage();
 const travelChecks=useTravelCheckReminders(trips,accountId);
 const [open,setOpen]=useState(false);
 const [now,setNow]=useState(()=>new Date());
 const [read,setRead]=useState<string[]>([]);
 const root=useRef<HTMLDivElement>(null);
 const trigger=useRef<HTMLButtonElement>(null);
 const storageKey=`motteku-notifications-read-${accountId}`;
 useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem(storageKey)||'[]');setRead(Array.isArray(saved)?saved.filter((id:unknown)=>typeof id==='string'):[]);}catch{setRead([]);}},[storageKey]);
 useEffect(()=>{const timer=window.setInterval(()=>setNow(new Date()),60000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{
  if(!('Notification'in window)||Notification.permission!=='granted')return;
  const today=dateKey(now);
  for(const trip of trips){
   const reminders=tripReminders(trip.startDate,trip.prepStartDate);
   for(const reminder of reminders){
    if(reminder.date!==today)continue;
    const key=reminderNotificationKey(accountId,trip.id,reminder.date,reminder.id);
    try{if(localStorage.getItem(key))continue;new Notification(`${t(reminder.title)}: ${trip.name}`,{body:t(reminder.detail),tag:key});localStorage.setItem(key,'1')}catch{}
   }
  }
 },[now,trips,t,accountId]);
 useEffect(()=>{if(!open)return;const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);trigger.current?.focus();}};document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};},[open]);
 const today=dateKey(now);
 const end=new Date(now);end.setDate(end.getDate()+7);
 const until=dateKey(end);
 const notices:Notice[]=[];
 for(const {scope,check} of travelChecks){
   const reminder=travelReminderAt(check);
   const source=trips.find(trip=>(trip.sharedChatId||`${accountId==='local'?'local-owner':accountId}_${trip.id}`)===scope);
   if(!source||check.archived||check.status==='completed'||!reminder||new Date(reminder)>now)continue;
   notices.push({id:`${scope}:${check.id}:${reminder}`,tripId:source.id,title:t(checkpointTitle(check)),detail:`${source.name} · ${check.snapshotAt?t('Unresolved items: {count}',{count:checkProgress(check).unresolved.length}):t('It is time to start this item check.')}`,date:reminder,tab:'Item check'});
 }
 for(const trip of trips){
  if(!validReminderDate(trip.startDate)||trip.startDate<today)continue;
  const add=(id:string,date:string,title:string,detail:string,tab='Reminders')=>{if(validReminderDate(date)&&date<=until)notices.push({id:`${trip.id}:${id}:${date}`,tripId:trip.id,title,detail,date,tab});};
  add('prep',tripReminders(trip.startDate,trip.prepStartDate).find(reminder=>reminder.id==='prep')!.date,t('Preparation starts'),trip.name);
  if(trip.startDate){const before=new Date(`${trip.startDate}T12:00:00`);before.setDate(before.getDate()-1);const date=dateKey(before);if(date>=today)add('packing',date,t('Day before departure'),trip.name);}
  add('departure',trip.startDate,t('Trip departure'),trip.name);
  for(const item of trip.items)if(item.status!=='Packed')add(`item:${item.id}`,item.dueDate,t('Item deadline'),`${trip.name} · ${item.name}`,'Packing list');
 }
 notices.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 const unread=notices.filter(notice=>!read.includes(notice.id)).length;
 const markRead=(ids:string[])=>{const next=Array.from(new Set([...read,...ids]));setRead(next);try{localStorage.setItem(storageKey,JSON.stringify(next));}catch{}};
 return <div className="notification-center" ref={root}>
  <button ref={trigger} type="button" className="notification-trigger" title={t('Notifications')} aria-label={`${t('Notifications')} (${unread})`} aria-expanded={open} aria-controls="notification-panel" onClick={()=>setOpen(value=>!value)}><Bell size={20}/>{unread>0&&<span className="notification-badge">{unread>99?'99+':unread}</span>}</button>
  {open&&<section id="notification-panel" className="notification-panel" aria-label={t('Notifications')}>
   <div className="notification-heading"><h2>{t('Notifications')}</h2><button type="button" className="icon-button" aria-label={t('Close notifications')} onClick={()=>{setOpen(false);trigger.current?.focus();}}><X size={16}/></button></div>
   <p className="notification-summary">{t('Upcoming reminders for the next 7 days and overdue tasks.')}</p>
   {unread>0&&<button type="button" className="soft-button" onClick={()=>markRead(notices.map(notice=>notice.id))}><CheckCheck size={15}/>{t('Mark all as read')}</button>}
   <div className="notification-list">{notices.length?notices.map(notice=><button type="button" key={notice.id} className={`notification-entry${read.includes(notice.id)?'':' unread'}`} onClick={()=>{markRead([notice.id]);setOpen(false);onOpen(notice.tripId,notice.tab);}}><span><b>{notice.title}</b><small>{notice.detail}</small></span><time dateTime={notice.date}>{formatDate(notice.date,notice.tab==='Item check')}{notice.date<today&&<em>{t('Overdue')}</em>}</time></button>):<p className="empty-inline">{t('No notifications. You are all caught up!')}</p>}</div>
  </section>}
 </div>;
}
