'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInAnonymously, signOut, type User } from 'firebase/auth';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db, firebaseConfigured } from '@/lib/firebase';
import { CalendarDays, Check, CheckCheck, CloudSun, Copy, Download, History, ListChecks, LoaderCircle, MessageCircle, Plus, RefreshCw, ShoppingCart, Sparkles, Users, Wallet, Weight, X, TentTree, Trash2, Save, Cloud, ClipboardCheck, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import TripChat, { parseChatInvitation } from '@/components/TripChat';
import TripPacking from '@/components/TripPacking';
import PackingPreview, { type PackingDraftItem } from '@/components/PackingPreview';
import BagPacking from '@/components/BagPacking';
import PrepReminders from '@/components/PrepReminders';
import { useLanguage } from '@/lib/i18n';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AccountMenu from '@/components/AccountMenu';
import NewTripDialog from '@/components/NewTripDialog';
import NotificationCenter from '@/components/NotificationCenter';
import { errorKey } from '@/lib/messages';
import { usePacking } from '@/lib/usePacking';
import { isCurrentAssignment, packingItemName, reconcilePacking, requiredQuantity, type TemplateSelection } from '@/lib/packing';
import { packingTemplates } from '@/lib/packingTemplates';
import MemberRemovalDialog from '@/components/MemberRemovalDialog';

type ItemStatus = 'Owned' | 'Need to buy' | 'Purchased' | 'Packed';
type Item = { quantity?:number; id:string; name:string; category:string; status:ItemStatus; assignee:string; weight:number; price:number; paidBy:string; comment:string; dueDate:string; receiptUrl:string; bagId?:string; bagLocation?:string };
type Member = { id:string; name:string };
type Expense = {id:string;name:string;amount:number;payer:string};
type Bag = {id:string;name:string;photoUrl:string;verified:boolean};
type Trip = { pendingPacking?:TemplateSelection[]; id:string; name:string; type:string; location:string; startDate:string; endDate:string; prepStartDate?:string; people:number; budget:number; members:Member[]; items:Item[]; expenses:Expense[]; bags:Bag[]; sharedChatId?:string; inviteCode?:string; createdAt:string };
type Workspace = { trips:Trip[]; activeTripId:string; history:Trip[] };
const templates:Record<string,string[]> = {
  Camping:['Tent','Sleeping bag','Sleeping mat','Flashlight','Portable charger','Water bottle','First aid kit','Rain jacket','Cooking set','Trash bags'],
  'Overseas travel':['Passport','Flight tickets','Wallet','Phone charger','Travel adapter','Clothes','Toiletries','Medication','Travel insurance details'],
  Beach:['Swimwear','Towel','Sunscreen','Sunglasses','Water bottle','Sandals','Change of clothes'],
  Hiking:['Hiking shoes','Water bottle','Trail snacks','First aid kit','Rain jacket','Map / offline map','Headlamp','Warm layer'],
  'School event':['Student ID','Notebook','Pens','Laptop','Charger','Water bottle','Lunch','Umbrella']
};
const uid = () => Math.random().toString(36).slice(2,10);
const newItem = (name:string, category='General'):Item => ({id:uid(),name,category,status:'Need to buy',assignee:'Unassigned',weight:0,price:0,paidBy:'',comment:'',dueDate:'',receiptUrl:''});
const normalizeTrip=(t:any):Trip=>({...t,items:(t.items||[]).map((i:any)=>({...newItem(i.name||'Item'),...i,bagId:i.bagId||'',bagLocation:i.bagLocation||''})),members:t.members||[],expenses:t.expenses||[],bags:t.bags||[]});
const normalizeWorkspace=(data:any):Workspace=>({trips:(data.trips||[]).map(normalizeTrip),activeTripId:data.activeTripId||'',history:(data.history||[]).map(normalizeTrip)});
const seed:Workspace = { trips:[{id:'demo-trip',name:'Osaka Camping Weekend',type:'Camping',location:'Osaka, Japan',startDate:new Date(Date.now()+7*86400000).toISOString().slice(0,10),endDate:new Date(Date.now()+9*86400000).toISOString().slice(0,10),prepStartDate:new Date(Date.now()+4*86400000).toISOString().slice(0,10),people:3,budget:15000,members:[{id:'m1',name:'Han'},{id:'m2',name:'Aki'},{id:'m3',name:'Yuki'}],items:templates.Camping.map((n,i)=>({...newItem(n,'Camping'),status:i<3?'Owned':'Need to buy',assignee:['Han','Aki','Yuki'][i%3],weight:[2.5,1.4,0.8,0.3,0.2,0.6,0.4,0.3,1.2,0.2][i],price:[0,0,0,1200,1800,500,900,1800,2500,300][i],paidBy:i===3?'Aki':''})),expenses:[],bags:[],createdAt:new Date().toISOString()}],activeTripId:'demo-trip',history:[]};
function weatherLabel(code:number,translate:(text:string)=>string){ if(code===0)return translate('Clear'); if([1,2,3].includes(code))return translate('Partly cloudy'); if([45,48].includes(code))return translate('Fog'); if(code>=51&&code<=67)return translate('Rain'); if(code>=71&&code<=77)return translate('Snow'); if(code>=80&&code<=82)return translate('Rain showers'); if(code>=95)return translate('Thunderstorm'); return translate('Mixed'); }
export default function Home(){
 const {language,setLanguage,t:tr,date}=useLanguage();
 const router=useRouter();
 const [sidebarCollapsed,setSidebarCollapsed]=useState(false);
 const [loggingOut,setLoggingOut]=useState(false);
 const skipAnonymousSignIn=useRef(false);

 const yen=(n:number)=>new Intl.NumberFormat(language==='ja'?'ja-JP':'en-US',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(n||0);
 const [workspace,setWorkspace]=useState<Workspace>(seed); const [ready,setReady]=useState(false); const [user,setUser]=useState<User|null>(null); const [remoteLoaded,setRemoteLoaded]=useState(false); const [remoteError,setRemoteError]=useState(false); const [tab,setTab]=useState('Overview'); const [newName,setNewName]=useState(''); const [newType,setNewType]=useState('Camping'); const [newLocation,setNewLocation]=useState('Osaka, Japan'); const [newStart,setNewStart]=useState(new Date(Date.now()+7*86400000).toISOString().slice(0,10)); const [newEnd,setNewEnd]=useState(new Date(Date.now()+9*86400000).toISOString().slice(0,10)); const [newBudget,setNewBudget]=useState('15000'); const [itemName,setItemName]=useState(''); const [memberName,setMemberName]=useState(''); const [expenseName,setExpenseName]=useState(''); const [expenseAmount,setExpenseAmount]=useState(''); const [expensePayer,setExpensePayer]=useState(''); const [weather,setWeather]=useState<any>(null); const [weatherLoading,setWeatherLoading]=useState(false); const [adviceByLanguage,setAdviceByLanguage]=useState<Record<string,any>>({}); const [adviceLoading,setAdviceLoading]=useState(false); const [notice,setNotice]=useState('');
 const [noticeParams,setNoticeParams]=useState<Record<string,string|number>>({});
 const [newMemberNames,setNewMemberNames]=useState('');
 const newTravelers=newMemberNames.split('\n').map(name=>name.trim()).filter(Boolean);
 const [memberToRemove,setMemberToRemove]=useState<Member|null>(null);
 const applyingDraft=useRef('');
 const [rosterScope,setRosterScope]=useState('');
 const bootstrappingRoster=useRef('');
 const automaticRecalculation=useRef('');
 const [showCreateTrip,setShowCreateTrip]=useState(false);
 const [tripDraft,setTripDraft]=useState<Trip|null>(null);
 const [draftItems,setDraftItems]=useState<PackingDraftItem[]>([]);
 const [draftLoading,setDraftLoading]=useState(false);
 const [draftError,setDraftError]=useState('');
 const active=workspace.trips.find(t=>t.id===workspace.activeTripId) || workspace.trips[0];
 const packingUid=user?.uid || (firebaseConfigured ? '' : 'local-owner');
 const packingScope=ready && active && packingUid ? active.sharedChatId || packingUid + '_' + active.id : '';
 const packing=usePacking(packingScope,active?.id || '',active?.sharedChatId || '',packingUid,active?.members || [],active?.bags || []);
 const travelMembers=packing.loaded && packing.data ? packing.data.members.filter(m=>m.active!==false) : active?.members || [];
 const memberAdmin=!!packing.data && (packing.data.ownerUid===packingUid || packing.data.adminUids.includes(packingUid));
 const adviceKey=active ? active.id + ':' + language : '';
 const advice=adviceByLanguage[adviceKey] || Object.entries(adviceByLanguage).find(([key,value])=>key.startsWith(active?.id + ':') && value.builtIn)?.[1];
 const autoAdviceRequests=useRef(new Set<string>());
 const setAdvice=(result:any)=>setAdviceByLanguage(current=>({...current,[adviceKey]:result}));
 const updateTrip=(fn:(trip:Trip)=>Trip)=>setWorkspace(w=>({...w,trips:w.trips.map(t=>t.id===w.activeTripId?fn(t):t)}));
 useEffect(()=>{
   if(!firebaseConfigured || !auth || !db){try{const saved=localStorage.getItem('motteku-workspace');if(saved){const parsed=normalizeWorkspace(JSON.parse(saved));if(parsed.trips?.length)setWorkspace(parsed);}}catch{}setReady(true);return;}
   const unsubscribe=onAuthStateChanged(auth, u=>{setUser(u);if(!u && !skipAnonymousSignIn.current)signInAnonymously(auth!).catch(e=>{console.error(e);setNotice('Firebase sign-in failed. Check that Anonymous Authentication is enabled.');setReady(true);});});
   return ()=>unsubscribe();
 },[]);
 useEffect(()=>{
   if(!firebaseConfigured || !db || !user)return;
   const ref=doc(db,'users',user.uid,'workspace','main');
   const unsubscribe=onSnapshot(ref,snap=>{if(snap.exists()){const data=normalizeWorkspace(snap.data());if(data.trips?.length)setWorkspace(data);}setRemoteLoaded(true);setReady(true);},()=>{try{const saved=localStorage.getItem('motteku-workspace');if(saved){const parsed=normalizeWorkspace(JSON.parse(saved));if(parsed.trips?.length)setWorkspace(parsed);}}catch{}setRemoteError(true);setNotice('Firebase access was denied. Using local demo mode; publish firestore.rules in the matching Firebase project to restore cloud sync.');setRemoteLoaded(true);setReady(true);});
   return ()=>unsubscribe();
 },[user]);
 useEffect(()=>{if(!ready)return;if(firebaseConfigured&&db&&user&&!remoteError){if(!remoteLoaded)return;const ref=doc(db,'users',user.uid,'workspace','main');setDoc(ref,workspace,{merge:true}).catch(()=>{setRemoteError(true);setNotice('Firebase access was denied. Using local demo mode; publish firestore.rules in the matching Firebase project to restore cloud sync.');});}else{try{localStorage.setItem('motteku-workspace',JSON.stringify(workspace));}catch{}}},[workspace,ready,user,remoteLoaded,remoteError]);
 const expenses=active?.expenses||[];
 const currentPackingRows=packing.loaded && packing.data ? packing.data.assignments.filter(a=>packing.data!.items.some(item=>isCurrentAssignment(item,a))) : [];
 const templateSelections:TemplateSelection[]=packing.loaded && packing.data ? packing.data.items.filter(i=>i.template).map(i=>({template:i.template!,...(i.customName?{customName:i.name}:{})})) : active?.pendingPacking || [];
 const stats=useMemo(()=>{if(!active)return {total:0,packed:0,need:0,weight:0,spent:0};return {total:active.items.length+currentPackingRows.length,packed:active.items.filter(i=>i.status==='Packed').length+currentPackingRows.filter(a=>a.status==='packed').length,need:active.items.filter(i=>i.status==='Need to buy').length,weight:active.items.reduce((s,i)=>s+(Number(i.weight)||0),0),spent:active.items.reduce((s,i)=>s+((['Purchased','Packed'].includes(i.status)?Number(i.price)||0:0)),0)}},[active,packing.data,packing.loaded]);
 const addTrip=async()=>{
   if(draftLoading)return;
   if(!newLocation.trim()||!newStart||!newEnd||newEnd<newStart||!newTravelers.length||newTravelers.length>100||newTravelers.some(name=>name.length>200)){setDraftError('Enter a destination, valid dates and 1–100 member names.');return;}
   setDraftLoading(true);setDraftError('');
   try{
     const trip:Trip={id:uid(),name:newName.trim()||tr(newType),type:newType,location:newLocation.trim(),startDate:newStart,endDate:newEnd,prepStartDate:newStart,people:newTravelers.length,budget:Number(newBudget)||0,members:newTravelers.map(name=>({id:uid(),name})),items:[],expenses:[],bags:[],createdAt:new Date().toISOString()};
     setDraftItems((packingTemplates[trip.type]||[]).map(template=>({id:template.id,name:'',quantity:requiredQuantity(template,trip.members.length),template})));
     setTripDraft(trip);
   }catch(error){setDraftError(errorKey(error,'Suggestions could not be generated.'));}
   finally{setDraftLoading(false);}
 };
 const confirmTrip=()=>{
   if(!tripDraft||!draftItems.length||draftItems.some(i=>(!i.template&&!i.name.trim())||!Number.isSafeInteger(i.quantity)||i.quantity<1))return;
   const trip:Trip={...tripDraft,pendingPacking:draftItems.map(i=>({template:i.template || {id:'custom-'+i.id,nameKey:'Custom item',category:'General',type:'shared',quantityRule:'fixed',fixedQuantity:i.quantity,unitKey:'unit.items'},...(i.name.trim()?{customName:i.name.trim()}:{})})),items:[]};
   setWorkspace(w=>({...w,trips:[trip,...w.trips],activeTripId:trip.id}));
   setTripDraft(null);setDraftItems([]);setDraftError('');setNewName('');setShowCreateTrip(false);setTab('Packing list');setNotice('Trip and confirmed packing list saved.');
 };
 useEffect(()=>{
   if(!active?.pendingPacking?.length||!packing.loaded||!packing.data||packing.busy||!memberAdmin||rosterScope!==packingScope||applyingDraft.current===active.id)return;
   const id=active.id;
   applyingDraft.current=id;
   try{
     const next=reconcilePacking(packing.data,travelMembers,packingScope,packingUid,active.pendingPacking);
     void packing.commitPlan(next).then(saved=>{
       if(saved)setWorkspace(w=>({...w,trips:w.trips.map(trip=>trip.id===id?{...trip,pendingPacking:[]}:trip)}));
     });
   }catch(error){packing.setError(errorKey(error,'Check your input.'));}
 },[active?.id,active?.pendingPacking,packing.loaded,packing.busy,memberAdmin,rosterScope]);
 useEffect(()=>{
   if(!active||!packing.loaded||!packing.data||packing.busy||!memberAdmin||rosterScope===packingScope||bootstrappingRoster.current===packingScope)return;
   bootstrappingRoster.current=packingScope;
   // Import previously registered members once; never resurrect a deliberately deactivated member.
   const missing=active.members.filter(member=>!packing.data!.members.some(old=>old.id===member.id));
   if(!missing.length){setRosterScope(packingScope);return;}
   try{
     const next=reconcilePacking(packing.data,[...travelMembers,...missing],packingScope,packingUid);
     void packing.commitPlan(next).then(saved=>{if(saved)setRosterScope(packingScope);});
   }catch(error){packing.setError(errorKey(error,'Check your input.'));}
 },[active?.id,packing.loaded,packing.busy,memberAdmin,rosterScope]);
 useEffect(()=>{
   if(!packing.loaded||!packing.data||packing.busy||!memberAdmin||rosterScope!==packingScope||active?.pendingPacking?.length)return;
   try{
     const next=reconcilePacking(packing.data,travelMembers,packingScope,packingUid);
     const metadataChanged=next.items.some(item=>{const old=packing.data!.items.find(i=>i.id===item.id);return !old||old.quantity!==item.quantity||JSON.stringify(old.targetMemberIds)!==JSON.stringify(item.targetMemberIds);});
     if(!metadataChanged&&next.assignments.length===packing.data.assignments.length)return;
     const signature=packingScope+JSON.stringify([travelMembers.map(m=>m.id),next.items.map(i=>[i.id,i.quantity,i.targetMemberIds]),packing.data.assignments.map(a=>a.id)]);
     if(automaticRecalculation.current===signature)return;
     automaticRecalculation.current=signature;
     void packing.commitPlan(next);
   }catch(error){packing.setError(errorKey(error,'Check your input.'));}
 },[packing.data,packing.loaded,packing.busy,memberAdmin,rosterScope,active?.pendingPacking]);
 const changeStatus=(id:string,status:ItemStatus)=>updateTrip(t=>({...t,items:t.items.map(i=>i.id===id?{...i,status}:i)}));
 const addItem=()=>{if(!itemName.trim())return;updateTrip(t=>({...t,items:[...t.items,newItem(itemName.trim(),t.type)]}));setItemName('');};
 const assignFairly=()=>{if(!travelMembers.length)return;let idx=0;updateTrip(t=>({...t,items:t.items.map(i=>{if(i.assignee==='Unassigned'||!travelMembers.some(m=>m.name===i.assignee)){const assignee=travelMembers[idx%travelMembers.length].name;idx++;return {...i,assignee};}return i;})}));setNotice('Unassigned items were distributed across members.');};
 const addMember=async()=>{
   if(!memberName.trim()||!active||!packing.loaded||!packing.data||!memberAdmin||packing.busy)return;
   try{
     const nextMembers=[...travelMembers,{id:uid(),name:memberName.trim()}];
     const next=reconcilePacking(packing.data,nextMembers,packingScope,packingUid);
     if(await packing.commitPlan(next)){updateTrip(t=>({...t,members:nextMembers.map(m=>({id:m.id,name:m.name})),people:nextMembers.length}));setMemberName('');}
   }catch(error){packing.setError(errorKey(error,'Check your input.'));}
 };
 const confirmMemberRemoval=async()=>{
   if(!memberToRemove||!packing.loaded||!packing.data||!memberAdmin||travelMembers.length<=1)return;
   const nextMembers=travelMembers.filter(m=>m.id!==memberToRemove.id);
   const next=reconcilePacking(packing.data,nextMembers,packingScope,packingUid);
   if(await packing.commitPlan(next)){
     updateTrip(t=>({...t,members:nextMembers.map(m=>({id:m.id,name:m.name})),people:nextMembers.length,items:t.items.map(i=>i.assignee===memberToRemove.name?{...i,assignee:'Unassigned'}:i)}));
     setMemberToRemove(null);
   }
 };
 useEffect(()=>{setMemberToRemove(null);},[active?.id]);
 const fetchWeather=async()=>{setWeatherLoading(true);setWeather(null);try{const geo=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(active.location.split(',')[0])}&count=1&language=${language}&format=json`);const gd=await geo.json();const place=gd.results?.[0];if(!place)throw new Error('Location not found. Try a city name like Osaka.');const r=await fetch(`/api/weather?lat=${place.latitude}&lon=${place.longitude}&language=${language}`);const d=await r.json();if(!r.ok)throw new Error(d.error||'Weather unavailable');setWeather({...d,place});}catch(e:any){setNotice(errorKey(e,'Weather could not be loaded.'))}finally{setWeatherLoading(false)}};
 const getAdvice=async()=>{autoAdviceRequests.current.add(adviceKey);setAdviceLoading(true);try{const r=await fetch('/api/advice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({language,trip:{name:active.name,type:active.type,location:active.location,startDate:active.startDate,endDate:active.endDate,people:active.people},weather:weather?.daily||null,items:active.items.map(i=>({name:i.name,status:i.status,weight:i.weight}))})});const d=await r.json();if(d.result)setAdvice(d.result);else if(!d.configured){const rainy=weather?.daily?.precipitation_probability_max?.some((x:number)=>x>=40);const cold=weather?.daily?.temperature_2m_min?.some((x:number)=>x<10);const suggested=[...(rainy?['Umbrella','Rain jacket','Waterproof bag']:[]),...(cold?['Warm jacket','Thermal layer']:[]),...(active.type==='Camping'?['Headlamp','First aid kit','Trash bags']:[]),...(active.type==='Hiking'?['Trail snacks','Offline map']:[])];setAdvice({builtIn:true,advice:'Built-in suggestions are based on your trip type and available forecast. Add or remove items to fit your group.',suggestedItems:[...new Set(suggested)],cautions:['Forecasts can change; check again before departure.']});}else throw new Error(d.error||'AI advice failed');}catch(e:any){setNotice(errorKey(e,'Advice could not be generated.'))}finally{setAdviceLoading(false)}};
 useEffect(()=>{setWeather(null);},[active?.id]);
 useEffect(()=>{if(active && tab==='Weather & AI' && !advice && Object.keys(adviceByLanguage).some(key=>key.startsWith(active.id + ':')) && !autoAdviceRequests.current.has(adviceKey)) void getAdvice();},[language,adviceByLanguage,active?.id,tab]);
 const finishTrip=()=>{setWorkspace(w=>({...w,history:[{...active,members:travelMembers.map(m=>({id:m.id,name:m.name})),people:travelMembers.length,pendingPacking:templateSelections},...w.history],trips:w.trips.filter(t=>t.id!==active.id),activeTripId:w.trips.find(t=>t.id!==active.id)?.id||''}));setNotice('Trip moved to history.');};
  const handleJoinedChat = (roomId: string, code: string, roomName: string) => {
    setWorkspace((current) => {
      const existing = current.trips.find((trip) => trip.sharedChatId === roomId);
      if (existing) {
        return {
          ...current,
          activeTripId: existing.id,
          trips: current.trips.map((trip) => trip.id === existing.id ? { ...trip, inviteCode: code } : trip),
        };
      }
      const joinedTrip: Trip = {
        id: uid(), name: roomName || tr("Shared group"), type: "Shared trip",
        location: "", startDate: "", endDate: "", prepStartDate: "",
        people: 1, budget: 0,
        members: [{ id: user?.uid || uid(), name: user?.displayName || user?.email?.split("@")[0] || "Me" }],
        items: [], expenses: [], bags: [], sharedChatId: roomId, inviteCode: code,
        createdAt: new Date().toISOString(),
      };
      return { ...current, trips: [joinedTrip, ...current.trips], activeTripId: joinedTrip.id };
    });
    setTab("Group chat");
  };
  const toggleSidebar = () =>
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem("motteku-sidebar-collapsed", String(next));
      } catch {}
      return next;
    });
  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    skipAnonymousSignIn.current = true;
    try {
      if (auth) await signOut(auth);
      router.replace("/login");
    } catch {
      skipAnonymousSignIn.current = false;
      setLoggingOut(false);
      setNotice("Could not log out. Please try again.");
    }
  };
  useEffect(() => {
    try {
      setSidebarCollapsed(
        localStorage.getItem("motteku-sidebar-collapsed") === "true",
      );
    } catch {}
  }, []);
  useEffect(() => {
    const incoming = parseChatInvitation(window.location.href);
    let pending = incoming;
    try {
      if (incoming) {
        sessionStorage.setItem("motteku-pending-chat-invite", JSON.stringify(incoming));
      } else {
        const saved = JSON.parse(sessionStorage.getItem("motteku-pending-chat-invite") || "null");
        if (saved && typeof saved.roomId === "string" && typeof saved.code === "string") {
          pending = parseChatInvitation(`${window.location.origin}/?joinChat=${encodeURIComponent(saved.roomId)}&inviteCode=${encodeURIComponent(saved.code)}`);
        }
      }
    } catch {}
    if (pending) setTab("Group chat");
  }, []);
 const tripCreationForm = <section className="panel create-panel" id="create-trip"><div className="panel-head"><div><h3 id="create-trip-title">{tr("Create a new trip")}</h3><p>{tr("Enter trip details and member names, then review calculated quantities.")}</p></div><Plus className="muted-icon"/></div><fieldset disabled={draftLoading || !!tripDraft} className="trip-details"><form className="create-form" onSubmit={e=>{e.preventDefault();addTrip()}}><label>{tr("Trip name")}<input value={newName} onChange={e=>setNewName(e.target.value)} placeholder={tr("e.g. Summer beach trip")}/></label><label>{tr("Trip type")}<select value={newType} onChange={e=>setNewType(e.target.value)}>{Object.keys(templates).map(t=><option key={t} value={t}>{tr(t)}</option>)}</select></label><label>{tr("Destination")}<input value={newLocation} onChange={e=>setNewLocation(e.target.value)} placeholder={tr("Example: Osaka, Japan")}/></label><label>{tr("Start date")}<input type="date" value={newStart} onChange={e=>setNewStart(e.target.value)}/></label><label>{tr("End date")}<input type="date" min={newStart} value={newEnd} onChange={e=>setNewEnd(e.target.value)}/></label><label>{tr("Group budget (¥)")}<input type="number" min="0" value={newBudget} onChange={e=>setNewBudget(e.target.value)}/></label><label>{tr("Participant names (one per line)")}<textarea required value={newMemberNames} onChange={e=>setNewMemberNames(e.target.value)} placeholder={tr("Example member names")}/><small>{tr("Members: {count}",{count:newTravelers.length})}</small></label><button className="primary" type="submit" disabled={draftLoading}>{draftLoading?<LoaderCircle className="spin" size={16}/>:<Sparkles size={16}/>} {tr(draftLoading?'Generating suggestions...':'Generate template preview')}</button></form></fieldset>{draftError&&<p role="status">{tr(draftError)}</p>}{tripDraft&&<PackingPreview items={draftItems} setItems={setDraftItems} onConfirm={confirmTrip} onCancel={()=>{setTripDraft(null);setDraftItems([]);setDraftError('');}}/>}</section>;
 const nav=[['Overview',CalendarDays],['Packing list',ListChecks],['Bags & photos',ClipboardCheck],['Group chat',MessageCircle],['Reminders',CalendarDays],['Members',Users],['Budget',Wallet],['Weather & AI',CloudSun],['History',History]] as const;
 if(!ready)return <main className="loading"><LoaderCircle className="spin" size={28}/> {tr('Loading Motteku…')}</main>;
  return <main className="app-shell">
      <aside
        className={sidebarCollapsed ? "sidebar sidebar-collapsed" : "sidebar"}
      >
        <div className="sidebar-header">
          <div className="brand">
            <div className="brand-mark">
              <TentTree size={25} />
              <button
                className="sidebar-toggle"
                type="button"
                onClick={toggleSidebar}
                title={tr(
                  sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar",
                )}
                aria-label={tr(
                  sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar",
                )}
                aria-expanded={!sidebarCollapsed}
                aria-controls="workspace-navigation"
              >
                {sidebarCollapsed ? (
                  <PanelLeftOpen size={18} />
                ) : (
                  <PanelLeftClose size={18} />
                )}
              </button>
            </div>
            <div className="brand-copy">
              <b>Motteku</b>
              <small>{tr("Pack together, go further")}</small>
            </div>
          </div>
        </div>
        <div className="sidebar-scroll">
          <div className="workspace-label">{tr("WORKSPACE")}</div>
          <nav id="workspace-navigation" aria-label={tr("WORKSPACE")}>
            {nav.map(([label, Icon]) => (
              <button
                key={label}
                className={`nav-item ${tab === label ? "selected" : ""}`}
                title={tr(label)}
                aria-current={tab === label ? "page" : undefined}
                onClick={() => setTab(label)}
              >
                <Icon size={18} />
                <span>{tr(label)}</span>
                {label === "Packing list" && active && (
                  <em>{active.items.length + (packing.loaded ? packing.data?.items.length || 0 : 0)}</em>
                )}
              </button>
            ))}
          </nav>
        </div>
        <div className="sidebar-footer">
          <div className="sidebar-bottom">
            <div className="sync-dot" />
            <span>
              {tr(
                firebaseConfigured && user && !remoteError
                  ? "Firebase connected mode"
                  : "Local demo mode",
              )}
            </span>
            <small>
              {tr(
                firebaseConfigured && user && !remoteError
                  ? "Changes sync to Firestore"
                  : "Data saved in this browser",
              )}
            </small>
          </div>
          <button
            className="logout-button"
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            title={tr(loggingOut ? "Signing out…" : "Log out")}
            aria-label={tr(loggingOut ? "Signing out…" : "Log out")}
          >
            <LogOut size={18} />
            <span>{tr(loggingOut ? "Signing out…" : "Log out")}</span>
          </button>
        </div>
      </aside>
      <section className="main-area">
        <header className="topbar">
          <div>
            <div className="eyebrow">
              {tr("YOUR NEXT ADVENTURE STARTS HERE")}
            </div>
            <h1>
              {tr(
                tab === "Overview"
                  ? "Trip overview"
                  : tab === "Packing list"
                    ? "Packing checklist"
                    : tab === "Bags & photos"
                      ? "Bags & item locations"
                      : tab === "Group chat"
                        ? "Trip group chat"
                        : tab === "Reminders"
                          ? "Preparation reminders"
                          : tab === "Members"
                            ? "Your travel crew"
                            : tab === "Budget"
                              ? "Budget & expenses"
                              : tab === "Weather & AI"
                                ? "Weather & smart advice"
                                : "Trip history",
              )}
            </h1>
          </div>
          <div className="top-actions"><Link className="auth-link" href="/trips">{tr("Your trips")}</Link>
            <NotificationCenter
              trips={workspace.trips}
              accountId={user?.uid || "local"}
              onOpen={(tripId, nextTab) => {
                setWorkspace((w) => ({ ...w, activeTripId: tripId }));
                setTab(nextTab);
              }}
            />
            {(!user || user.isAnonymous) && (
              <Link className="auth-link" href="/login">
                {tr("Log in")}
              </Link>
            )}
            <select
              aria-label={tr("Select trip")}
              disabled={packing.busy} value={active?.id || ""}
              onChange={(e) =>
                setWorkspace((w) => ({ ...w, activeTripId: e.target.value }))
              }
            >
              {workspace.trips.length ? (
                workspace.trips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))
              ) : (
                <option value="">{tr("No active trip")}</option>
              )}
            </select>
            <select
              className="language-select"
              aria-label={tr("Language")}
              value={language}
              onChange={(e) => setLanguage(e.target.value as "ja" | "en")}
            >
              <option value="ja">{tr("Japanese")}</option>
              <option value="en">{tr("English")}</option>
            </select>
            <NewTripDialog open={showCreateTrip} onOpenChange={setShowCreateTrip} busy={draftLoading}>{tripCreationForm}</NewTripDialog>
            {user && !user.isAnonymous && (
              <AccountMenu key={user.uid} user={user} onLogout={handleLogout} loggingOut={loggingOut} />
            )}
          </div>
        </header>
  {notice&&<div className="notice"><span>{tr(notice,noticeParams)}</span><button onClick={()=>setNotice('')} aria-label={tr("Dismiss")}><X size={16}/></button></div>}
  {packing.error && tab!=='Packing list' && <p className="notice" role="alert">{tr(packing.error)}</p>}
  {memberToRemove && packing.loaded && packing.data && travelMembers.length>1 && <MemberRemovalDialog data={packing.data} next={reconcilePacking(packing.data,travelMembers.filter(m=>m.id!==memberToRemove.id),packingScope,packingUid)} removed={packing.data.members.filter(m=>m.id===memberToRemove.id)} legacyCount={active.items.filter(i=>i.assignee===memberToRemove.name).length} busy={packing.busy} onCancel={()=>setMemberToRemove(null)} onConfirm={()=>void confirmMemberRemoval()}/>}
  {!active&&tab!=='History'&&tab!=='Group chat'?<section className="empty-state"><TentTree size={42}/><h2>{tr("Ready to plan your next trip?")}</h2><p>{tr("Create a trip below to start your packing list.")}</p></section>:active&&<>
  {tab==='Overview'&&<>
   <section className="hero-card"><div className="hero-copy"><span className="pill"><span className="pill-dot"/>{tr(active.type).toUpperCase()} {tr('PLAN')}</span><h2>{active.name}</h2><p><CalendarDays size={16}/>{date(active.startDate)} → {date(active.endDate)}</p><p><Cloud size={16}/>{active.location}</p><div className="hero-buttons"><button className="light-button" onClick={()=>setTab('Packing list')}><ListChecks size={16}/> {tr("Open checklist")}</button></div></div><div className="hero-art"><div className="sun"/><div className="mountain mountain-back"/><div className="mountain mountain-front"/><div className="tiny-tent"><span/></div></div></section>
   <div className="stats-grid"><Stat icon={<ListChecks/>} label={tr("Packing progress")} value={`${stats.packed}/${stats.total}`} sub={`${stats.total?Math.round(stats.packed/stats.total*100):0}% ${tr('packed')}`} color="purple"/><Stat icon={<ShoppingCart/>} label={tr("Still to buy")} value={String(stats.need)} sub={tr("items on your list")} color="orange"/><Stat icon={<Weight/>} label={tr("Total item weight")} value={`${stats.weight.toFixed(1)} kg`} sub={tr("across all items")} color="blue"/><Stat icon={<Wallet/>} label={tr("Purchased total")} value={yen(stats.spent)} sub={`${tr('budget')} ${yen(active.budget)}`} color="green"/></div>
   <div className="content-grid"><section className="panel"><div className="panel-head"><div><h3>{tr("Pack your essentials")}</h3><p>{tr("Check off items as your group gets ready.")}</p></div><button className="text-button" onClick={()=>setTab('Packing list')}>{tr("View all")} <span>→</span></button></div><div className="progress-line"><span style={{width:`${stats.total?stats.packed/stats.total*100:0}%`}}/></div><div className="item-list">{packing.loaded && packing.data && packing.data.items.length>0 && <><p>{tr('Open the checklist to update each member or shared unit.')}</p>{packing.data.items.slice(0,5).map(item=><div className="quick-item" key={item.id}><span>{packingItemName(item,tr)}</span><small>{tr(item.type==='personal'?'Personal':'Shared')}</small><button className="text-button" onClick={()=>setTab('Packing list')}>{tr('Open checklist')}</button></div>)}</>}{active.items.slice(0,6).map(i=><div className="quick-item" key={i.id}><button className={`check-circle ${i.status==='Packed'?'checked':''}`} onClick={()=>changeStatus(i.id,i.status==='Packed'?'Owned':'Packed')}>{i.status==='Packed'&&<Check size={14}/>}</button><span className={i.status==='Packed'?'muted strike':''}>{i.name}</span><small>{i.assignee==='Unassigned'?tr('Unassigned'):i.assignee}</small><select value={i.status} onChange={e=>changeStatus(i.id,e.target.value as ItemStatus)} aria-label={tr("Status: {name}",{name:i.name})}>{(['Owned','Need to buy','Purchased','Packed'] as ItemStatus[]).map(s=><option key={s} value={s}>{tr(s)}</option>)}</select></div>)}</div></section><section className="panel"><div className="panel-head"><div><h3>{tr("Trip details")}</h3><p>{tr("Keep the essentials in one place.")}</p></div><CalendarDays size={20} className="muted-icon"/></div><div className="detail-list"><Detail label={tr("Destination")} value={active.location}/><Detail label={tr("Trip type")} value={tr(active.type)}/><Detail label={tr("Group size")} value={`${travelMembers.length} ${tr("members")}`}/><Detail label={tr("Budget per person")} value={yen(active.budget/Math.max(1,travelMembers.length))}/></div><div className="member-row">{travelMembers.slice(0,5).map((m,i)=><span className={`avatar avatar-${i%5}`} key={m.id} title={m.name}>{m.name.slice(0,1).toUpperCase()}</span>)}<button className="add-avatar" onClick={()=>setTab('Members')}><Plus size={15}/></button><span className="member-caption">{travelMembers.length} {tr("travelers")}</span></div><button className="wide-soft" onClick={()=>setTab('Members')}>{tr("Manage group members")} <span>→</span></button></section></div>
  </>}
  {tab==='Packing list'&&<><TripPacking packing={packing} tripType={active.type} key={`${active.id}:${active.sharedChatId||''}`} tripId={active.id} roomId={active.sharedChatId} userUid={user?.uid} members={travelMembers} bags={active.bags||[]} legacyItems={active.items}/><details className="panel legacy-packing"><summary>{tr("Legacy checklist / shopping management")}</summary>  <section className="panel page-panel"><div className="panel-head"><div><h3>{tr("Everything you need to bring")}</h3><p>{tr("Track ownership, shopping, weight and responsibility.")}</p></div><span className="count-badge">{active.items.length} {tr('items')}</span></div><form className="add-row" onSubmit={e=>{e.preventDefault();addItem()}}><input placeholder={tr("Add an item, e.g. portable charger")} value={itemName} onChange={e=>setItemName(e.target.value)}/><button className="primary" type="submit"><Plus size={16}/> {tr("Add item")}</button></form><div className="table-wrap"><table><thead><tr><th>{tr("Item")}</th><th>{tr("Status")}</th><th>{tr("Assigned to")}</th><th>{tr("Weight (kg)")}</th><th>{tr("Price (¥)")}</th><th>{tr("Comment")}</th><th></th></tr></thead><tbody>{active.items.map(i=><tr key={i.id}><td><b>{i.name}{(i.quantity||1)>1?` x ${i.quantity}`:null}</b><small className="cell-sub">{tr(i.category)}</small></td><td><select className={`status-select status-${i.status.replaceAll(' ','-').toLowerCase()}`} value={i.status} onChange={e=>changeStatus(i.id,e.target.value as ItemStatus)}>{(['Owned','Need to buy','Purchased','Packed'] as ItemStatus[]).map(s=><option key={s} value={s}>{tr(s)}</option>)}</select></td><td><select value={i.assignee} onChange={e=>updateTrip(t=>({...t,items:t.items.map(x=>x.id===i.id?{...x,assignee:e.target.value}:x)}))}><option value="Unassigned">{tr("Unassigned")}</option>{travelMembers.map(m=><option key={m.id}>{m.name}</option>)}</select></td><td><input className="table-input number" type="number" min="0" step="0.1" value={i.weight} onChange={e=>updateTrip(t=>({...t,items:t.items.map(x=>x.id===i.id?{...x,weight:Number(e.target.value)}:x)}))}/></td><td><input className="table-input number" type="number" min="0" step="1" value={i.price} onChange={e=>updateTrip(t=>({...t,items:t.items.map(x=>x.id===i.id?{...x,price:Number(e.target.value)}:x)}))}/></td><td><input className="table-input" placeholder={tr("Add note…")} value={i.comment} onChange={e=>updateTrip(t=>({...t,items:t.items.map(x=>x.id===i.id?{...x,comment:e.target.value}:x)}))}/></td><td><button className="icon-button danger" aria-label={tr("Delete {name}",{name:i.name})} onClick={()=>updateTrip(t=>({...t,items:t.items.filter(x=>x.id!==i.id)}))}><Trash2 size={15}/></button></td></tr>)}</tbody></table></div><div className="bottom-actions"><button className="soft-button" onClick={assignFairly}><Users size={16}/> {tr("Auto-assign unassigned")}</button><button className="soft-button" onClick={()=>{const csv=[['Item','Quantity','Type','Status','Assigned to','Weight (kg)','Price (¥)','Comment'].map(label=>tr(label)).join(','),...active.items.map(i=>[i.name,i.quantity||1,tr(i.category),tr(i.status),i.assignee==='Unassigned'?tr('Unassigned'):i.assignee,i.weight,i.price,i.comment].map(v=>`"${String(v).replaceAll('"','""')}"`).join(','))].join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'}));a.download='motteku-packing-list.csv';a.click();URL.revokeObjectURL(a.href)}}><Download size={16}/> {tr("Export CSV")}</button></div></section></details></>}
   {tab==='Bags & photos'&&<BagPacking bags={active.bags||[]} items={active.items} chatId={active.sharedChatId} userUid={user?.uid} onBagsChange={bags=>{updateTrip(t=>({...t,bags}));if(memberAdmin)void packing.mutate(current=>({...current,bags}),(batch,parent)=>batch.update(parent,{bags,bagIds:bags.map(b=>b.id)}));}} onItemChange={(id,bagId,location)=>updateTrip(t=>({...t,items:t.items.map(i=>i.id===id?{...i,bagId,bagLocation:location}:i)}))} onSharedPlanChange={(bags,placements)=>updateTrip(t=>({...t,bags,items:t.items.map(i=>{const shared=placements.find(p=>p.name.toLowerCase()===i.name.toLowerCase());return shared?{...i,bagId:shared.bagId,bagLocation:shared.bagLocation}:i})}))} onNotice={setNotice}/>}

   {tab==='Reminders'&&<PrepReminders tripId={active.id} tripName={active.name} startDate={active.startDate} prepStartDate={active.prepStartDate} items={active.items} onPrepDate={date=>updateTrip(t=>({...t,prepStartDate:date}))} onNotice={setNotice}/>}
   {tab==='Members'&&<div className="content-grid"><section className="panel page-panel"><div className="panel-head"><div><h3>{tr("Travel crew")}</h3><p>{tr("Add members and assign items fairly.")}</p></div><Users className="muted-icon"/></div><form className="add-row" onSubmit={e=>{e.preventDefault();addMember()}}><input placeholder={tr("Member name")} value={memberName} onChange={e=>setMemberName(e.target.value)}/><button className="primary" disabled={!memberAdmin || !packing.loaded || packing.busy}><Plus size={16}/> {tr("Add member")}</button></form><div className="crew-list">{travelMembers.map((m,idx)=><div className="crew-card" key={m.id}><span className={`avatar avatar-${idx%5} big-avatar`}>{m.name.slice(0,1).toUpperCase()}</span><div className="crew-info"><b>{m.name}</b><small>{tr("{count} assigned items",{count:active.items.filter(i=>i.assignee===m.name).length})} · {active.items.filter(i=>i.assignee===m.name).reduce((s,i)=>s+i.weight,0).toFixed(1)} kg</small></div><button className="icon-button danger" onClick={()=>{setMemberToRemove(m)}} disabled={!memberAdmin || !packing.loaded || packing.busy || travelMembers.length<=1} aria-label={tr("Delete {name}",{name:m.name})}><Trash2 size={16}/></button></div>)}</div><button className="primary" onClick={assignFairly}><Users size={16}/> {tr("Auto-assign unassigned items")}</button></section><section className="panel page-panel"><div className="panel-head"><div><h3>{tr("Load balance")}</h3><p>{tr("Compare how much each person carries.")}</p></div><Weight className="muted-icon"/></div>{travelMembers.map(m=>{const kg=active.items.filter(i=>i.assignee===m.name).reduce((s,i)=>s+i.weight,0);const max=Math.max(1,...travelMembers.map(mm=>active.items.filter(i=>i.assignee===mm.name).reduce((s,i)=>s+i.weight,0)));return <div className="load-row" key={m.id}><div><b>{m.name}</b><span>{kg.toFixed(1)} kg</span></div><div className="load-track"><span style={{width:`${kg/max*100}%`}}/></div></div>})}<p className="helper-note">{tr("The auto-assign tool distributes only unassigned items. You can manually change assignments to balance weight more accurately.")}</p></section></div>}
  {tab==='Budget'&&<div className="content-grid"><section className="panel page-panel"><div className="panel-head"><div><h3>{tr("Trip budget")}</h3><p>{tr("Track planned budget and purchased items.")}</p></div><Wallet className="muted-icon"/></div><label className="field-label">{tr("Group budget (¥)")}<input type="number" min="0" value={active.budget} onChange={e=>updateTrip(t=>({...t,budget:Number(e.target.value)}))}/></label><div className="budget-summary"><div><span>{tr("Total purchased items")}</span><b>{yen(stats.spent)}</b></div><div><span>{tr("Budget remaining")}</span><b className={active.budget-stats.spent<0?'text-danger':''}>{yen(active.budget-stats.spent)}</b></div><div><span>{tr("Equal share per member")}</span><b>{yen(stats.spent/Math.max(1,travelMembers.length))}</b></div></div><div className="progress-line budget-progress"><span style={{width:`${active.budget?Math.min(100,stats.spent/active.budget*100):0}%`}}/></div><p className="helper-note">{tr("Purchased total counts the price of items marked “Purchased” or “Packed”. Mark an item as Purchased after buying it.")}</p></section><section className="panel page-panel"><div className="panel-head"><div><h3>{tr("Expense log")}</h3><p>{tr("Record who paid for shared purchases.")}</p></div><Wallet className="muted-icon"/></div><form className="expense-form" onSubmit={e=>{e.preventDefault();if(!expenseName.trim()||Number(expenseAmount)<=0)return;updateTrip(t=>({...t,expenses:[...(t.expenses||[]),{id:uid(),name:expenseName.trim(),amount:Number(expenseAmount),payer:expensePayer||t.members[0]?.name||'Me'}]}));setExpenseName('');setExpenseAmount('');}}><input placeholder={tr("Expense name")} value={expenseName} onChange={e=>setExpenseName(e.target.value)}/><input placeholder={tr("Amount (¥)")} type="number" min="1" value={expenseAmount} onChange={e=>setExpenseAmount(e.target.value)}/><select value={expensePayer} onChange={e=>setExpensePayer(e.target.value)}><option value="">{tr("Paid by…")}</option>{travelMembers.map(m=><option key={m.id}>{m.name}</option>)}</select><button className="primary"><Plus size={16}/> {tr("Add")}</button></form>{expenses.length===0?<div className="empty-inline">{tr("No expenses recorded yet. Add a purchase above.")}</div>:<><div className="expense-list">{expenses.map(x=><div className="expense-row" key={x.id}><div><b>{x.name}</b><small>{tr("Paid by {name}",{name:x.payer})}</small></div><strong>{yen(x.amount)}</strong><button className="icon-button danger" onClick={()=>updateTrip(t=>({...t,expenses:(t.expenses||[]).filter(y=>y.id!==x.id)}))}><Trash2 size={15}/></button></div>)}</div><div className="settlement"><h4>{tr("Equal split summary")}</h4><p>{tr("Total: {total} ÷ {count} people = {share} per person.",{total:yen(expenses.reduce((s,x)=>s+x.amount,0)),count:Math.max(1,travelMembers.length),share:yen(expenses.reduce((s,x)=>s+x.amount,0)/Math.max(1,travelMembers.length))})}</p>{travelMembers.map(m=>{const paid=expenses.filter(x=>x.payer===m.name).reduce((s,x)=>s+x.amount,0);const share=expenses.reduce((s,x)=>s+x.amount,0)/Math.max(1,travelMembers.length);return <div className="settle-row" key={m.id}><span>{m.name}</span><span>{tr("Paid {amount}",{amount:yen(paid)})}</span><b className={paid-share>=0?'text-green':'text-danger'}>{tr(paid-share>=0?"Gets back {amount}":"Owes {amount}",{amount:yen(Math.abs(paid-share))})}</b></div>})}</div></>}</section></div>}
  {tab==='Weather & AI'&&<div className="content-grid"><section className="panel page-panel"><div className="panel-head"><div><h3>{tr("Destination forecast")}</h3><p>{tr("Weather helps your group pack smarter.")}</p></div><CloudSun className="muted-icon"/></div><label className="field-label">{tr("Destination or city")}<input value={active.location} onChange={e=>updateTrip(t=>({...t,location:e.target.value}))} placeholder={tr("Example: Osaka, Japan")}/></label><button className="primary" onClick={fetchWeather} disabled={weatherLoading}>{weatherLoading?<LoaderCircle className="spin" size={16}/>:<RefreshCw size={16}/>} {tr('Get 7-day forecast')}</button>{weather?.daily&&<div className="forecast-grid">{weather.daily.time.map((day:string,i:number)=><div className="forecast-day" key={day}><small>{date(day)}</small><CloudSun size={24}/><b>{Math.round(weather.daily.temperature_2m_max[i])}° / {Math.round(weather.daily.temperature_2m_min[i])}°</b><span>{weatherLabel(weather.daily.weather_code[i],tr)}</span><small>{weather.daily.precipitation_probability_max[i]??0}% {tr('rain')}</small></div>)}</div>}<p className="helper-note">{tr("Weather is provided by Open-Meteo. Forecasts may not cover the entire trip if it is more than 7 days away.")}</p></section><section className="panel page-panel"><div className="panel-head"><div><h3>{tr("AI packing advice")}</h3><p>{tr("Get suggestions based on your trip and forecast.")}</p></div><Sparkles className="muted-icon"/></div><div className="ai-banner"><Sparkles size={23}/><div><b>{tr("Your trip, thoughtfully packed")}</b><p>{tr("Suggestions adapt to trip type, destination and forecast when available.")}</p></div></div><button className="primary" onClick={getAdvice} disabled={adviceLoading}>{adviceLoading?<LoaderCircle className="spin" size={16}/>:<Sparkles size={16}/>} {tr('Generate suggestions')}</button>{advice&&<div className="advice-results"><h4>{tr("Recommendation")}</h4><p>{advice.builtIn?tr(advice.advice):advice.advice}</p>{advice.suggestedItems?.length>0&&<><h4>{tr("Suggested items")}</h4>{advice.suggestedItems.map((n:string)=><button className="suggestion-chip" key={n} onClick={()=>{if(!active.items.some(i=>i.name.toLowerCase()===(advice.builtIn?tr(n):n).toLowerCase()))updateTrip(t=>({...t,items:[...t.items,newItem(advice.builtIn?tr(n):n,'AI suggestion')]}));setNoticeParams({name:advice.builtIn?tr(n):n});setNotice("{name} added to the packing list.")}}><Plus size={13}/>{advice.builtIn?tr(n):n}</button>)}</>}{advice.cautions?.length>0&&<><h4>{tr("Things to remember")}</h4><ul>{advice.cautions.map((n:string)=><li key={n}>{advice.builtIn?tr(n):n}</li>)}</ul></>}</div>}<p className="helper-note">{tr("If no Gemini key is configured, Motteku uses simple built-in suggestions. Add GEMINI_API_KEY in .env.local to enable Gemini.")}</p></section></div>}
  </>}
   {tab === "Group chat" && (
          <TripChat
            tripId={active?.id || ""}
            chatId={active?.sharedChatId}
            inviteCode={active?.inviteCode}
            userUid={user?.uid}
            userName={user?.displayName || user?.email?.split("@")[0] || ""}
            tripName={active?.name || tr("Shared group")}
            onRoomChange={(id, code) => {
              if (!active) return;
              setWorkspace((current) => ({
                ...current,
                trips: current.trips.map((trip) => trip.id === active.id ? { ...trip, sharedChatId: id, inviteCode: code } : trip),
              }));
            }}
            onJoinedRoom={handleJoinedChat}
            onNotice={setNotice}
          />
        )}
   {tab==='History'&&<section className="panel page-panel"><div className="panel-head"><div><h3>{tr("Past trips")}</h3><p>{tr("Copy a previous packing list and reuse it.")}</p></div><History className="muted-icon"/></div>{workspace.history.length===0?<div className="empty-inline">{tr("Completed trips will appear here when you finish a trip.")}</div>:workspace.history.map(t=><div className="history-card" key={t.id}><div className="history-icon"><ClipboardCheck size={20}/></div><div className="history-info"><b>{t.name}</b><small>{t.location} · {tr("{count} items",{count:t.items.length})} · {date(t.startDate)}</small></div><button className="soft-button" onClick={()=>{const cp={...t,id:uid(),name:`${t.name} (${tr("Copy")})`,pendingPacking:(t.pendingPacking||[]),createdAt:new Date().toISOString(),bags:[],sharedChatId:'',inviteCode:'',items:t.items.map(i=>({...i,id:uid(),status:'Need to buy' as ItemStatus,bagId:'',bagLocation:''}))};setWorkspace(w=>({...w,trips:[cp,...w.trips],activeTripId:cp.id}));setTab('Overview')}}><Copy size={15}/> {tr("Reuse list")}</button><button type="button" className="history-delete" onClick={()=>{if(window.confirm(tr("Delete {name}?",{name:t.name})))setWorkspace(w=>({...w,history:w.history.filter(item=>item.id!==t.id)}))}}><Trash2 size={15}/><span>{tr("Delete")}</span></button></div>)}</section>}
  <footer>{tr("Made for groups who want to spend less time packing and more time exploring.")} <span>{tr("Motteku · Prototype")}</span></footer></section>
 </main>;
}
function Stat({
  icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${color}`}>{icon}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
