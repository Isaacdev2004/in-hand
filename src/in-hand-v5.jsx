import { useState, useRef, useEffect } from "react";
import { supabase } from "./lib/supabaseClient";
import { Capacitor } from "@capacitor/core";
import { getAuthRedirectUrl, handleSupabaseAuthDeepLink } from "./lib/authRedirect";
import { getListingShareUrl, parseListingIdFromUrl, tryOpenListingInApp } from "./lib/shareLinks";
import { fetchAppDatabaseShape, userFromRow } from "./lib/databaseToAppState";
import {
  createListing,
  updateListing,
  deleteListing,
  swapTradeListings,
} from "./lib/listingsApi";
import {
  upsertTransaction,
  updateTransaction,
  upsertShipment,
  updateShipmentById,
  updateShipmentByTxnId,
  insertConversation,
  insertChatMessage,
  updateConversationFlags,
  insertDispute,
  updateDisputeById,
  insertRating,
  tryReleaseEscrow,
  insertNotification,
  markNotificationRead,
  markAllNotificationsRead,
} from "./lib/marketplaceApi";
import { startStripeCheckout } from "./lib/stripeCheckout";
import { createShippingLabel } from "./lib/shippoLabel";
import { ensureUserProfile } from "./lib/authSession";
import { updateOwnUser } from "./lib/usersApi";
import {
  BellIcon,
  figureInitials,
  stripToastEmoji,
  UI_FONT,
  UserAvatar,
  VerifiedInHandBadge,
  getListingVideoEmbed,
} from "./lib/mobileUi";

const LOGO_IMG = (process.env.PUBLIC_URL || "") + "/in-hand-logo.png";
// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const LINE_COLOR = {
  "G.I. Joe":            { from: "#ff6b6b", to: "#ee5a24", light: "#fff0f0" },
  "Transformers":        { from: "#3A7BD5", to: "#5B8DD9", light: "#f0f0ff" },
  "Masters of Universe": { from: "#f9ca24", to: "#f0932b", light: "#fffbf0" },
  "Star Wars":           { from: "#6c5ce7", to: "#a29bfe", light: "#f5f0ff" },
  "TMNT":                { from: "#00b894", to: "#55efc4", light: "#f0fff8" },
};
const lc = (line) => LINE_COLOR[line] || { from: "#636e72", to: "#b2bec3", light: "#f7f7f7" };
// ─── BRAND CATALOGUE ─────────────────────────────────────────────────────────
const BRANDS = [
  { name:"Hasbro",    lines:["G.I. Joe","Transformers","Marvel Legends","Power Rangers","Star Wars (Hasbro)"] },
  { name:"Kenner",    lines:["Star Wars (Vintage)","Batman","Aliens","Terminator","Super Powers"] },
  { name:"Mattel",    lines:["Masters of Universe","WWE","Hot Wheels","DC Universe"] },
  { name:"Playmates", lines:["TMNT","Star Trek","Simpsons"] },
  { name:"NECA",      lines:["Predator","Alien","TMNT (NECA)","IT","Terminator (NECA)"] },
  { name:"McFarlane", lines:["DC Multiverse","Halo","Mortal Kombat","NFL","NBA"] },
  { name:"Bandai",    lines:["Dragon Ball","Gundam","Power Rangers (Bandai)","S.H.Figuarts"] },
  { name:"Funko",     lines:["POP!","Funko Gold","Bitty POP!"] },
  { name:"Mezco",     lines:["One:12 Collective","Toony Terrors","Mega-Scale"] },
  { name:"Super7",    lines:["ReAction","Ultimate","MOTU (Super7)","Ultimates!"] },
  { name:"Hot Toys",  lines:["Marvel (Hot Toys)","DC (Hot Toys)","Star Wars (Hot Toys)","Movie Masterpiece"] },
  { name:"Sideshow",  lines:["Premium Format","Comiquette","Sixth Scale"] },
  { name:"Custom",    lines:["Custom Build","Repaint","Kitbash","Scratch Built","3D Printed"] },
  { name:"Other",     lines:["Independent","Unknown"] },
];

const ALL_LINES = ["All", ...BRANDS.flatMap(b => b.lines)];
const ALL_BRANDS = ["All", ...BRANDS.map(b => b.name)];
const getLinesForBrand = (brand) => brand === "All" ? ALL_LINES : (BRANDS.find(b=>b.name===brand)?.lines || ALL_LINES.slice(1));

const AVATARS = ["🦖","🤖","🎖️","🏰","🌌","🐢","💀","⚙️","🥷","🚀","🍕","🎯","🐍","📻","🟠","⚔️","🌑","🔫"];
const FIGURE_EMOJIS = ["🥷","🤖","⚔️","🌑","🐢","💀","🔫","🤍","⚡","🍕","🎯","🐍","📻","🟠","🦸","🧙","👾","🛡️","🗡️","🔱"];
const PLATFORM_FEE = 0.05;      // 5% on sales
const TRADE_FEE    = 2.00;      // $2 flat per party per trade

// ─── CONDITION HELPERS ────────────────────────────────────────────────────────
const condLabel = (isNew) => (isNew ? "Brand New" : "Used");
const condColor = (isNew) => isNew ? "#3A7BD5" : "#888";
const condBg    = (isNew) => isNew ? "#f0f0ff" : "#EEF2F7";

// ─── MARKET VALUE DATABASE ────────────────────────────────────────────────────
// Each figure has separate new (sealed/inbox) and used (loose) market prices
// Dev will replace getMarketValue() with live eBay Sold Listings API
// eBay API: GET /buy/browse/v1/item_summary/search?q={name}+new&filter=soldItems:true
const MARKET_DATA = {
  "Snake Eyes (1982 O-Ring)":  { new:{ avg:520,  low:400,  high:680,  sales:6  }, used:{ avg:235, low:180, high:310, sales:14 }, trend:"up",   lastSold:"2024-11-09", history:[180,200,195,220,240,235,310,225,240,235,240,250,235,235] },
  "Optimus Prime G1 Boxed":    { new:{ avg:1300, low:980,  high:1700, sales:4  }, used:{ avg:550, low:420, high:720, sales:8  }, trend:"up",   lastSold:"2024-11-10", history:[420,450,500,480,530,560,550,600,580,550,570,720,610,550] },
  "He-Man MOTU (1982)":        { new:{ avg:210,  low:150,  high:290,  sales:5  }, used:{ avg:88,  low:60,  high:120, sales:22 }, trend:"flat", lastSold:"2024-11-07", history:[75,80,85,90,88,92,88,85,90,88,85,88,90,88] },
  "Darth Vader (12-back)":     { new:{ avg:2600, low:2000, high:3400, sales:3  }, used:{ avg:1100,low:900, high:1400,sales:5  }, trend:"up",   lastSold:"2024-11-05", history:[900,950,1000,1050,1100,1150,1200,1100,1050,1100,1150,1200,1100,1100] },
  "Leonardo '88":              { new:{ avg:680,  low:500,  high:900,  sales:5  }, used:{ avg:290, low:220, high:380, sales:11 }, trend:"up",   lastSold:"2024-11-11", history:[220,240,260,270,280,290,300,310,290,300,310,320,290,290] },
  "Skeletor Battle Armor":     { new:{ avg:340,  low:250,  high:460,  sales:4  }, used:{ avg:155, low:110, high:210, sales:9  }, trend:"flat", lastSold:"2024-11-08", history:[120,130,140,150,160,155,165,155,150,155,160,155,155,155] },
  "Megatron G1 Complete":      { new:{ avg:900,  low:700,  high:1150, sales:3  }, used:{ avg:400, low:320, high:500, sales:7  }, trend:"down", lastSold:"2024-11-06", history:[500,480,460,440,430,420,410,415,400,405,400,395,405,400] },
  "Storm Shadow (1984)":       { new:{ avg:390,  low:300,  high:520,  sales:7  }, used:{ avg:170, low:130, high:230, sales:16 }, trend:"up",   lastSold:"2024-11-12", history:[130,140,150,155,160,165,170,175,165,170,175,180,170,170] },
  "Luke Skywalker Bespin":     { new:{ avg:200,  low:145,  high:280,  sales:8  }, used:{ avg:90,  low:65,  high:130, sales:19 }, trend:"flat", lastSold:"2024-11-04", history:[75,80,85,88,90,92,90,88,90,92,90,88,90,90] },
  "Raphael Red Variant":       { new:{ avg:620,  low:480,  high:810,  sales:3  }, used:{ avg:280, low:210, high:360, sales:6  }, trend:"up",   lastSold:"2024-11-10", history:[210,230,250,265,270,280,290,280,285,280,290,300,280,280] },
  "Cobra Commander (Hood)":    { new:{ avg:390,  low:300,  high:520,  sales:5  }, used:{ avg:175, low:130, high:240, sales:12 }, trend:"up",   lastSold:"2024-11-08", history:[140,148,155,160,165,170,175,180,170,175,180,185,175,175] },
  "Soundwave G1 Complete":     { new:{ avg:1150, low:880,  high:1450, sales:4  }, used:{ avg:510, low:400, high:640, sales:9  }, trend:"up",   lastSold:"2024-11-09", history:[400,420,450,470,490,500,510,520,505,510,520,530,510,510] },
  "Boba Fett (Vintage)":       { new:{ avg:820,  low:640,  high:1050, sales:5  }, used:{ avg:360, low:280, high:460, sales:10 }, trend:"flat", lastSold:"2024-11-02", history:[300,310,330,340,350,360,355,360,365,355,360,365,360,360] },
  "Michelangelo '88":          { new:{ avg:620,  low:470,  high:800,  sales:6  }, used:{ avg:270, low:200, high:350, sales:13 }, trend:"up",   lastSold:"2024-11-11", history:[200,215,230,245,255,265,270,275,265,270,278,280,270,270] },
};

function getMarketValue(name) { return MARKET_DATA[name] || null; }

// Compare listing price against the correct tier (new or used)
function getPriceBadge(listingPrice, mv, isNew) {
  if (!mv) return null;
  const tier = isNew ? mv.new : mv.used;
  if (!tier) return null;
  const pct = ((listingPrice - tier.avg) / tier.avg) * 100;
  if (pct <= -15) return { label:"Great deal", color:"#1f7a5c", bg:"#edf7f2", short:"Great deal" };
  if (pct <= -5)  return { label:"Fair price", color:"#1f7a5c", bg:"#edf7f2", short:"Fair" };
  if (pct <= 10)  return { label:"At market", color:"#9a6700", bg:"#fbf4df", short:"At market" };
  if (pct <= 25)  return { label:"Above market", color:"#b42318", bg:"#fdeeed", short:"Above market" };
  return { label:"Overpriced", color:"#b42318", bg:"#fdeeed", short:"Overpriced" };
}

// ─── MARKET BADGE ─────────────────────────────────────────────────────────────
function MarketBadge({ name, value, isNew, mini }) {
  const mv = getMarketValue(name);
  if (!mv) return null;
  const badge = getPriceBadge(value, mv, isNew);
  if (!badge) return null;
  const tier = isNew ? mv.new : mv.used;
  if (mini) return (
    <span style={{ fontSize:9, background:badge.bg, color:badge.color, borderRadius:6, padding:"2px 7px", fontWeight:800 }}>{badge.short}</span>
  );
  return (
    <div style={{ display:"flex", alignItems:"center", gap:6, background:badge.bg, borderRadius:8, padding:"4px 10px", border:`1px solid ${badge.color}22` }}>
      <span style={{ fontSize:11, fontWeight:800, color:badge.color }}>{badge.label}</span>
      <span style={{ fontSize:10, color:"#aaa" }}>Mkt avg ${tier.avg}</span>
    </div>
  );
}

// ─── MARKET VALUE MODAL ───────────────────────────────────────────────────────
function MarketValueModal({ card, onClose }) {
  const mv = getMarketValue(card.name);
  const isNew = card.isNew;
  const { from } = lc(card.line);

  if (!mv) return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:700,display:"flex",alignItems:"flex-end",justifyContent:"center" }}>
      <div style={{ background:"#fff",borderRadius:"28px 28px 0 0",padding:"28px 20px 40px",width:"100%",maxWidth:430,textAlign:"center" }}>
        <div style={{ fontSize:40,marginBottom:12 }}>📡</div>
        <div style={{ fontWeight:800,fontSize:16,color:"#2C3E50",marginBottom:8 }}>No Market Data Yet</div>
        <div style={{ fontSize:12,color:"#aaa",marginBottom:20 }}>eBay sold data will appear here once the API is connected by your developer.</div>
        <Btn onClick={onClose} style={{ background:"#2C3E50",color:"#fff",width:"100%" }}>Got it</Btn>
      </div>
    </div>
  );

  const badge = getPriceBadge(card.value, mv, isNew);
  const activeTier = isNew ? mv.new : mv.used;
  const history = mv.history || [];
  const maxH = Math.max(...history), minH = Math.min(...history), range = maxH - minH || 1;
  const points = history.map((v,i) => `${(i/(history.length-1))*260},${40 - ((v-minH)/range)*36}`).join(" ");
  const trendColor = mv.trend==="up"?"#00b894":mv.trend==="down"?"#ff6b6b":"#f0932b";
  const trendIcon  = mv.trend==="up"?"↑":mv.trend==="down"?"↓":"→";

  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:700,display:"flex",alignItems:"flex-end",justifyContent:"center" }}>
      <div style={{ background:"#fff",borderRadius:"28px 28px 0 0",padding:"24px 20px 44px",width:"100%",maxWidth:430,maxHeight:"85vh",overflowY:"auto" }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18 }}>
          <div>
            <div style={{ fontWeight:800,fontSize:18,color:"#2C3E50" }}>📊 Market Value</div>
            <div style={{ fontSize:11,color:"#aaa",marginTop:2 }}>Based on recent eBay sales</div>
          </div>
          <button onClick={onClose} style={{ background:"#E4EBF2",border:"none",borderRadius:"50%",width:32,height:32,fontSize:16,cursor:"pointer" }}>✕</button>
        </div>

        {/* Figure + condition */}
        <div style={{ background:"#f9f9f9",borderRadius:16,padding:"12px 14px",marginBottom:16,display:"flex",gap:12,alignItems:"center" }}>
          <FigureImage card={card} size={56} borderRadius={12} />
          <div>
            <div style={{ fontWeight:800,fontSize:14,color:"#2C3E50" }}>{card.name}</div>
            <div style={{ display:"flex",gap:6,marginTop:4,alignItems:"center" }}>
              <span style={{ fontSize:10,fontWeight:800,background:condBg(isNew),color:condColor(isNew),borderRadius:6,padding:"2px 8px" }}>{condLabel(isNew)}</span>
              <span style={{ fontWeight:800,fontSize:13,color:from }}>Listed: ${card.value}</span>
              {badge && <span style={{ fontSize:10,background:badge.bg,color:badge.color,borderRadius:6,padding:"2px 8px",fontWeight:800 }}>{badge.short}</span>}
            </div>
          </div>
        </div>

        {/* Two-tier pricing cards */}
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16 }}>
          {[
            { key:"new", label:"📦 Brand New", tier:mv.new, active:isNew },
            { key:"used",label:"🔓 Used",       tier:mv.used, active:!isNew },
          ].map(({ key, label, tier, active }) => (
            <div key={key} style={{ background:active?"#2C3E50":"#f9f9f9", borderRadius:16, padding:"14px 12px", border:`2px solid ${active?"#2C3E50":"transparent"}` }}>
              <div style={{ fontSize:11,fontWeight:700,color:active?"rgba(255,255,255,0.6)":"#aaa",marginBottom:6 }}>{label}</div>
              <div style={{ fontWeight:900,fontSize:22,color:active?"#fff":from,marginBottom:2 }}>${tier.avg}</div>
              <div style={{ fontSize:10,color:active?"rgba(255,255,255,0.4)":"#ccc" }}>avg · ${tier.low}–${tier.high}</div>
              <div style={{ fontSize:10,color:active?"rgba(255,255,255,0.4)":"#ccc",marginTop:2 }}>{tier.sales} sales</div>
              {active && <div style={{ fontSize:9,background:"rgba(255,255,255,0.15)",color:"#fff",borderRadius:5,padding:"2px 7px",marginTop:6,display:"inline-block",fontWeight:700 }}>THIS LISTING</div>}
            </div>
          ))}
        </div>

        {/* Price position bar */}
        <div style={{ background:"#f9f9f9",borderRadius:14,padding:"14px",marginBottom:16 }}>
          <div style={{ display:"flex",justifyContent:"space-between",marginBottom:8 }}>
            <span style={{ fontSize:12,fontWeight:700,color:"#555" }}>Price Position</span>
            <span style={{ fontSize:12,fontWeight:800,color:badge?.color }}>{badge?.label}</span>
          </div>
          <div style={{ position:"relative",height:8,background:"linear-gradient(90deg,#00b894,#f9ca24,#ff6b6b)",borderRadius:6,marginBottom:6 }}>
            {(() => {
              const pct = Math.min(Math.max(((card.value - activeTier.low) / (activeTier.high - activeTier.low)) * 100, 2), 98);
              return <div style={{ position:"absolute",top:-4,left:`${pct}%`,transform:"translateX(-50%)",width:16,height:16,borderRadius:"50%",background:"#2C3E50",border:"3px solid #fff",boxShadow:"0 2px 6px rgba(0,0,0,0.2)" }} />;
            })()}
          </div>
          <div style={{ display:"flex",justifyContent:"space-between",fontSize:10,color:"#aaa" }}>
            <span>Low ${activeTier.low}</span><span>High ${activeTier.high}</span>
          </div>
        </div>

        {/* Sparkline (based on used history as baseline) */}
        <div style={{ background:"#f9f9f9",borderRadius:14,padding:"14px",marginBottom:16 }}>
          <div style={{ display:"flex",justifyContent:"space-between",marginBottom:10,alignItems:"center" }}>
            <span style={{ fontSize:12,fontWeight:700,color:"#555" }}>Used Price Trend</span>
            <span style={{ fontSize:12,fontWeight:800,color:trendColor }}>{trendIcon} {mv.trend.charAt(0).toUpperCase()+mv.trend.slice(1)}</span>
          </div>
          <svg width="100%" height="52" viewBox="0 0 260 44" style={{ overflow:"visible" }}>
            <defs>
              <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={trendColor} stopOpacity="0.2"/>
                <stop offset="100%" stopColor={trendColor} stopOpacity="0"/>
              </linearGradient>
            </defs>
            <polygon points={`0,44 ${points} 260,44`} fill="url(#sparkGrad)" />
            <polyline points={points} fill="none" stroke={trendColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {(() => { const lp=points.split(" "); const [lx,ly]=lp[lp.length-1].split(","); return <circle cx={lx} cy={ly} r="4" fill={trendColor} />; })()}
          </svg>
          <div style={{ display:"flex",justifyContent:"space-between",fontSize:10,color:"#ccc",marginTop:4 }}>
            <span>14 sales ago</span><span>Last sold {mv.lastSold}</span>
          </div>
        </div>

        <div style={{ background:"#EAF1FA",borderRadius:14,padding:"12px 14px",marginBottom:20,display:"flex",gap:10 }}>
          <span style={{ fontSize:18 }}>⚡</span>
          <div>
            <div style={{ fontWeight:700,fontSize:12,color:"#3A7BD5" }}>Powered by eBay Sold Listings</div>
            <div style={{ fontSize:11,color:"#888",marginTop:2 }}>Prices shown separately for Brand New and Used. Your dev connects the eBay API to keep these live.</div>
          </div>
        </div>
        <Btn onClick={onClose} style={{ background:"#2C3E50",color:"#fff",width:"100%" }}>Got it</Btn>
      </div>
    </div>
  );
}


// ─── SEED DATA ────────────────────────────────────────────────────────────────
// Mock seed data removed for production launch. Real data comes from Supabase.
const SEED_USERS = [];
const SEED_CARDS = [];
const SEED_TRANSACTIONS = [];

// USPS Ground shipping rates by value (flat rate boxes)
const USPS_RATES = [
  { maxValue: 50,   label: "Small Flat Rate Box",  price: 9.45,  insurance: 0    },
  { maxValue: 100,  label: "Medium Flat Rate Box", price: 14.65, insurance: 0    },
  { maxValue: 500,  label: "Large Flat Rate Box",  price: 19.95, insurance: 2.75 },
  { maxValue: 99999,label: "Large Flat Rate Box",  price: 19.95, insurance: 4.95 },
];
const INSURANCE_THRESHOLD = 100; // USPS includes $100 free — charge for above
const getShippingRate = (value) => USPS_RATES.find(r => value <= r.maxValue);
const getInsuranceCost = (value) => value > INSURANCE_THRESHOLD ? (USPS_RATES.find(r=>value<=r.maxValue)?.insurance||2.75) : 0;

const SEED_SHIPMENTS = [];
const SEED_DISPUTES = [];
const SEED_RATINGS = [];
const SEED_MESSAGES = [];

const NOTIF_TYPES = {
  trade_proposed:   { icon:"🤝", color:"#00b894", label:"Trade Proposed"    },
  message:          { icon:"💬", color:"#3A7BD5", label:"New Message"        },
  shipped:          { icon:"📦", color:"#f0932b", label:"Item Shipped"       },
  delivered:        { icon:"📬", color:"#f9ca24", label:"Delivered"          },
  funds_released:   { icon:"💰", color:"#00b894", label:"Funds Released"     },
  rated:            { icon:"⭐", color:"#f9ca24", label:"New Rating"         },
  dispute_update:   { icon:"🚨", color:"#ff6b6b", label:"Dispute Update"     },
  wishlist_match:   { icon:"🔥", color:"#4A90D9", label:"Wishlist Match!"    },
};

const SEED_NOTIFICATIONS = [];

const TRACKING_STEPS = ["Label Created","Accepted","In Transit","Out for Delivery","Delivered"];
const trackingStepIndex = (status) => status==="delivered"?4:status==="out_for_delivery"?3:status==="in_transit"?2:status==="accepted"?1:0;


const DEFAULT_USER_ID = "u1";

const NAV_ITEMS = [
  ["browse", "Browse"],
  ["trades", "Trades"],
  ["vault", "Vault"],
  ["messages", "Chat"],
  ["shipping", "Shipping"],
  ["wallet", "Wallet"],
  ["account", "Account"],
];

const EMPTY_DB = {
  users: [],
  cards: [],
  transactions: [],
  shipments: [],
  disputes: [],
  ratings: [],
  messages: [],
  notifications: [],
};
const fmt = (n) => n.toFixed(2);

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function computeMatch(myCards, theirCard, myWishlist) {
  const tradeable = myCards.filter(c => c.wantsTrade);
  if (!tradeable.length) return 50;
  return Math.min(tradeable.reduce((best, mine) => {
    let s = Math.round(Math.min(mine.value, theirCard.value) / Math.max(mine.value, theirCard.value) * 40);
    s += Math.min(theirCard.tags.filter(t => myWishlist.includes(t)).length * 10, 30);
    if (mine.line !== theirCard.line) s += 10;
    s += Math.round((theirCard.isNew ? 1.0 : 0.6) * 20);
    return s > best ? s : best;
  }, 0), 100);
}

// ─── CYCLING SUBTITLE ─────────────────────────────────────────────────────────
const WORDS = [
  { text:"BUY", color:"#3A7BD5" }, { text:"SELL", color:"#00b894" },
  { text:"TRADE", color:"#4A90D9" }, { text:"COLLECT", color:"#2980B9" }, { text:"OBSESS", color:"#5B8DD9" },
];
function CyclingSubtitle() {
  const [idx, setIdx] = useState(0); const [key, setKey] = useState(0);
  useEffect(() => { const t = setInterval(() => { setIdx(i=>(i+1)%WORDS.length); setKey(k=>k+1); }, 2400); return ()=>clearInterval(t); }, []);
  return (
    <div style={{ display:"flex", alignItems:"center", gap:5, height:16, overflow:"hidden" }}>
      <span>Collector marketplace</span>
      <span key={key} className="cycle-word" style={{ fontSize:9, fontWeight:900, color:WORDS[idx].color, letterSpacing:2 }}>{WORDS[idx].text}</span>
    </div>
  );
}

// ─── SHARED STYLES ────────────────────────────────────────────────────────────
const IS = { background:"#fff", border:"1px solid #d8e0ea", borderRadius:14, padding:"12px 14px", fontSize:14, fontFamily:UI_FONT, fontWeight:500, color:"#15202b", width:"100%", outline:"none" };
const TS = (on) => ({ flex:1, background:on?"#2C3E50":"#E4EBF2", border:"none", borderRadius:10, padding:"9px", textAlign:"center", fontSize:12, fontWeight:700, color:on?"#fff":"#aaa", cursor:"pointer", transition:"all 0.15s" });
const Btn = ({ children, onClick, style = {}, type = "button", disabled }) => <button type={type} onClick={onClick} disabled={disabled} style={{ border:"none", borderRadius:12, padding:"12px", fontWeight:700, fontSize:14, cursor:disabled?"not-allowed":"pointer", fontFamily:UI_FONT, ...style }}>{children}</button>;

// ─── CHECKOUT MODAL (card via Stripe Checkout — no prepaid wallet) ─────────────
function CheckoutModal({ card, seller, onPayWithCard, onClose }) {
  const [busy, setBusy] = useState(false);

  const fee = parseFloat((card.value * PLATFORM_FEE).toFixed(2));
  const shippingRate = getShippingRate(card.value);
  const shipping = shippingRate.price;
  const insurance = getInsuranceCost(card.value);
  const total = parseFloat((card.value + fee).toFixed(2));
  const grandTotal = parseFloat((total + shipping + insurance).toFixed(2));

  const handlePay = async () => {
    setBusy(true);
    try {
      await onPayWithCard();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:600, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div style={{ background:"#fff", borderRadius:"28px 28px 0 0", padding:"24px 20px 40px", width:"100%", maxWidth:430 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
          <div style={{ fontWeight:800, fontSize:18, color:"#2C3E50" }}>Review Purchase</div>
          <button onClick={onClose} disabled={busy} style={{ background:"#E4EBF2", border:"none", borderRadius:"50%", width:32, height:32, fontSize:16, cursor:"pointer" }}>✕</button>
        </div>

        <>
            <div style={{ background:"#f9f9f9", borderRadius:18, padding:"16px", marginBottom:16, display:"flex", gap:14, alignItems:"center" }}>
              <FigureImage card={card} size={60} borderRadius={14} />
              <div>
                <div style={{ fontWeight:800, fontSize:15, color:"#2C3E50" }}>{card.name}</div>
                <div style={{ fontSize:11, color:"#aaa" }}>{card.line} · {condLabel(card.isNew)}</div>
                <div style={{ fontWeight:800, fontSize:14, color:lc(card.line).from, marginTop:4 }}>${card.value}</div>
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:10, background:"#f9f9f9", borderRadius:14, padding:"10px 14px", marginBottom:16 }}>
              <span style={{ fontSize:22 }}>{seller.avatar}</span>
              <div>
                <div style={{ fontWeight:700, fontSize:12, color:"#2C3E50" }}>Seller: {seller.username}</div>
                <div style={{ fontSize:10, color:"#aaa" }}>⭐ {seller.rating} · {seller.tradesCompleted} transactions</div>
              </div>
            </div>
            <div style={{ background:"#f9f9f9", borderRadius:14, padding:"14px", marginBottom:12 }}>
              {[
                ["Item price", `$${card.value}`],
                [`In Hand fee (${(PLATFORM_FEE*100).toFixed(0)}%)`, `$${fmt(fee)}`],
                [`USPS Ground shipping (buyer pays)`, `$${fmt(shipping)}`],
                [`  ${shippingRate.label}`, ""],
                ...(insurance > 0 ? [[`USPS Shipping insurance`, `$${fmt(insurance)}`]] : []),
              ].map(([l,v])=> v ? (
                <div key={l} style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                  <span style={{ fontSize:13, color:"#888" }}>{l}</span><span style={{ fontSize:13, fontWeight:700, color:"#2C3E50" }}>{v}</span>
                </div>
              ) : <div key={l} style={{ fontSize:10, color:"#aaa", marginBottom:8, marginTop:-4 }}>{l}</div>)}
              <div style={{ borderTop:"1px solid #ebebeb", paddingTop:10, display:"flex", justifyContent:"space-between" }}>
                <span style={{ fontWeight:800, fontSize:14, color:"#2C3E50" }}>Total (you pay)</span>
                <span style={{ fontWeight:900, fontSize:16, color:"#2C3E50" }}>${fmt(grandTotal)}</span>
              </div>
              <div style={{ marginTop:8, display:"flex", justifyContent:"space-between" }}>
                <span style={{ fontSize:12, color:"#aaa" }}>Seller receives</span>
                <span style={{ fontSize:12, fontWeight:700, color:"#00b894" }}>${fmt(parseFloat((card.value * (1-PLATFORM_FEE)).toFixed(2)))}</span>
              </div>
            </div>
            <div style={{ background:"#fff8e6", borderRadius:12, padding:"10px 14px", marginBottom:12, display:"flex", gap:10, alignItems:"flex-start" }}>
              <span style={{ fontSize:18 }}>🔒</span>
              <div>
                <div style={{ fontWeight:700, fontSize:12, color:"#f0932b" }}>Escrow Protection</div>
                <div style={{ fontSize:11, color:"#888", marginTop:2 }}>Your payment is held safely until USPS tracking confirms delivery. Seller gets paid only when you receive it.</div>
              </div>
            </div>
            <div style={{ background:"#EAF1FA", borderRadius:12, padding:"10px 14px", marginBottom:20, fontSize:11, color:"#555", lineHeight:1.5 }}>
              You will pay with your <strong>debit or credit card</strong> on Stripe’s secure checkout. In Hand wallet balance is for <strong>sale earnings only</strong> — not used at purchase.
            </div>
            <Btn onClick={handlePay} disabled={busy} style={{ background:"#2C3E50", color:"#fff", width:"100%", opacity:busy?0.7:1 }}>
              {busy ? "Opening Stripe…" : `Pay $${fmt(grandTotal)} with card`}
            </Btn>
        </>
      </div>
    </div>
  );
}

// ─── TRADE SWEETENER MODAL ────────────────────────────────────────────────────
function TradeSweetenerModal({ myFigure, theirFigure, theirOwner, myUser, onConfirm, onClose }) {
  const [step, setStep] = useState("review"); // review | method | pin | success
  const [useWallet, setUseWallet] = useState(false);
  const [payMethod, setPayMethod] = useState(myUser.paymentMethods.find(p=>p.isDefault) || null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);

  const myVal = myFigure.value;
  const theirVal = theirFigure.value;
  const diff = theirVal - myVal; // positive = I owe them, negative = they owe me
  const iOwe = diff > 0;
  const sweetener = Math.abs(diff);
  const sweetenerFee = sweetener > 0 ? parseFloat((sweetener * PLATFORM_FEE).toFixed(2)) : 0;
  const fee = parseFloat((sweetenerFee + TRADE_FEE).toFixed(2)); // sweetener 5% + $2 trade fee
  const total = parseFloat((sweetener + fee).toFixed(2));
  const canAffordWallet = myUser.walletBalance >= total;

  const handleNext = () => {
    if (step==="review") { setStep("method"); return; }
    if (step==="method") { setStep(iOwe ? "pin" : "success"); if(!iOwe) onConfirm({ sweetener:0, fee:0, payMethod:"none" }); return; }
    if (step==="pin") {
      if (pin!=="1234") { setPinError(true); setTimeout(()=>setPinError(false),1200); setPin(""); return; }
      setStep("success");
      onConfirm({ sweetener, fee, total, payMethod: useWallet?"wallet":payMethod?.type||"card" });
    }
  };

  const {from: myFrom} = lc(myFigure.line);
  const {from: theirFrom} = lc(theirFigure.line);

  if (step==="success") return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center" }}>
      <div style={{ background:"#fff",borderRadius:28,padding:"40px 28px",maxWidth:360,width:"90%",textAlign:"center" }}>
        <div style={{ fontSize:64,marginBottom:16 }}>🤝</div>
        <div style={{ fontWeight:900,fontSize:22,color:"#2C3E50",marginBottom:8 }}>Trade Confirmed!</div>
        <div style={{ fontSize:13,color:"#aaa",marginBottom:6 }}>
          <strong style={{color:"#2C3E50"}}>{myFigure.name}</strong> ⇄ <strong style={{color:"#2C3E50"}}>{theirFigure.name}</strong>
        </div>
        {iOwe && <div style={{ fontSize:13,color:"#aaa",marginBottom:24 }}>Sweetener paid: <strong style={{color:"#00b894"}}>${fmt(total)}</strong></div>}
        {!iOwe && sweetener > 0 && <div style={{ fontSize:13,color:"#aaa",marginBottom:24 }}>You'll receive: <strong style={{color:"#00b894"}}>${fmt(sweetener)}</strong></div>}
        <Btn onClick={onClose} style={{ background:"#2C3E50",color:"#fff",width:"100%" }}>Done</Btn>
      </div>
    </div>
  );

  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:600,display:"flex",alignItems:"flex-end",justifyContent:"center" }}>
      <div style={{ background:"#fff",borderRadius:"28px 28px 0 0",padding:"24px 20px 40px",width:"100%",maxWidth:430,maxHeight:"90vh",overflowY:"auto" }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20 }}>
          <div style={{ fontWeight:800,fontSize:18,color:"#2C3E50" }}>
            {step==="review" ? "Trade + Sweetener" : step==="method" ? "Pay the Difference" : "Confirm PIN"}
          </div>
          <button onClick={onClose} style={{ background:"#E4EBF2",border:"none",borderRadius:"50%",width:32,height:32,fontSize:16,cursor:"pointer" }}>✕</button>
        </div>

        {/* STEP: REVIEW */}
        {step==="review" && (
          <>
            {/* The swap */}
            <div style={{ display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:10,alignItems:"center",marginBottom:16 }}>
              <div style={{ background:lc(myFigure.line).light,borderRadius:16,padding:"14px 12px",textAlign:"center" }}>
                <div style={{ fontSize:10,fontWeight:700,color:"#aaa",marginBottom:6,letterSpacing:0.8 }}>YOU GIVE</div>
                <div style={{ fontSize:36,marginBottom:6 }}>{myFigure.image}</div>
                <div style={{ fontWeight:800,fontSize:12,color:"#2C3E50",lineHeight:1.2 }}>{myFigure.name}</div>
                <div style={{ fontWeight:800,fontSize:13,color:myFrom,marginTop:4 }}>${myFigure.value}</div>
              </div>
              <div style={{ textAlign:"center" }}>
                <div style={{ fontSize:24 }}>⇄</div>
              </div>
              <div style={{ background:lc(theirFigure.line).light,borderRadius:16,padding:"14px 12px",textAlign:"center" }}>
                <div style={{ fontSize:10,fontWeight:700,color:"#aaa",marginBottom:6,letterSpacing:0.8 }}>YOU GET</div>
                <div style={{ fontSize:36,marginBottom:6 }}>{theirFigure.image}</div>
                <div style={{ fontWeight:800,fontSize:12,color:"#2C3E50",lineHeight:1.2 }}>{theirFigure.name}</div>
                <div style={{ fontWeight:800,fontSize:13,color:theirFrom,marginTop:4 }}>${theirFigure.value}</div>
              </div>
            </div>

            {/* Sweetener breakdown */}
            <div style={{ background: iOwe?"#fff8e6":"#f0fff8", border:`1.5px solid ${iOwe?"#f9ca24":"#00b894"}`, borderRadius:16,padding:"14px",marginBottom:16 }}>
              <div style={{ fontWeight:800,fontSize:13,color:"#2C3E50",marginBottom:10 }}>
                {iOwe ? "⚖️ You owe a sweetener" : sweetener>0 ? "⚖️ You receive a sweetener" : "⚖️ Even trade — no sweetener needed!"}
              </div>
              {[
                ["Their figure", `$${theirVal}`],
                ["Your figure", `$${myVal}`],
                ["Difference", `$${sweetener}`],
                ...(sweetener > 0 && iOwe ? [[`In Hand fee (${(PLATFORM_FEE*100).toFixed(0)}% of sweetener)`, `$${fmt(sweetenerFee)}`]] : []),
                ["In Hand trade fee (per party)", `$${fmt(TRADE_FEE)}`],
                ["Shipping (each ships their figure)", "Split equally"],
              ].map(([l,v])=>(
                <div key={l} style={{ display:"flex",justifyContent:"space-between",marginBottom:6 }}>
                  <span style={{ fontSize:12,color:"#888" }}>{l}</span>
                  <span style={{ fontSize:12,fontWeight:700,color:"#2C3E50" }}>{v}</span>
                </div>
              ))}
              {sweetener > 0 && (
                <div style={{ borderTop:`1px solid ${iOwe?"#f9ca2444":"#00b89444"}`,paddingTop:10,display:"flex",justifyContent:"space-between" }}>
                  <span style={{ fontWeight:800,fontSize:14,color:"#2C3E50" }}>{iOwe?"You pay total":"You receive"}</span>
                  <span style={{ fontWeight:900,fontSize:16,color:iOwe?"#f0932b":"#00b894" }}>${iOwe?fmt(total):fmt(sweetener)}</span>
                </div>
              )}
              {sweetener === 0 && (
                <div style={{ borderTop:"1px solid #E4EBF2",paddingTop:10,display:"flex",justifyContent:"space-between" }}>
                  <span style={{ fontWeight:800,fontSize:14,color:"#2C3E50" }}>Total fees each</span>
                  <span style={{ fontWeight:900,fontSize:16,color:"#3A7BD5" }}>${fmt(TRADE_FEE)} + shipping</span>
                </div>
              )}
            </div>

            {/* Other trader */}
            <div style={{ display:"flex",alignItems:"center",gap:10,background:"#f9f9f9",borderRadius:14,padding:"10px 14px",marginBottom:20 }}>
              <span style={{ fontSize:22 }}>{theirOwner.avatar}</span>
              <div>
                <div style={{ fontWeight:700,fontSize:12,color:"#2C3E50" }}>Trading with: {theirOwner.username}</div>
                <div style={{ fontSize:10,color:"#aaa" }}>⭐ {theirOwner.rating} · {theirOwner.tradesCompleted} trades</div>
              </div>
            </div>

            <Btn onClick={handleNext} style={{ background:"#2C3E50",color:"#fff",width:"100%" }}>
              {iOwe ? `Continue — Pay $${fmt(total)} sweetener →` : sweetener>0 ? "Confirm — Receive sweetener →" : "Confirm Even Trade 🤝"}
            </Btn>
          </>
        )}

        {/* STEP: METHOD (only shown if iOwe) */}
        {step==="method" && iOwe && (
          <>
            <div style={{ background:"#fff8e6",borderRadius:14,padding:"12px 14px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center" }}>
              <span style={{ fontSize:13,color:"#888",fontWeight:600 }}>Sweetener to pay</span>
              <span style={{ fontWeight:900,fontSize:18,color:"#f0932b" }}>${fmt(total)}</span>
            </div>
            <div onClick={()=>{ if(canAffordWallet) setUseWallet(true); }} style={{ background:useWallet?"#f0fff8":"#f9f9f9",border:`2px solid ${useWallet?"#00b894":"transparent"}`,borderRadius:16,padding:"14px 16px",marginBottom:10,cursor:canAffordWallet?"pointer":"default",opacity:canAffordWallet?1:0.65,display:"flex",alignItems:"center",gap:12 }}>
              <div style={{ fontSize:28 }}>💰</div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:800,fontSize:13,color:"#2C3E50" }}>Pay from sale earnings</div>
                <div style={{ fontSize:11,color:canAffordWallet?"#00b894":"#ff6b6b",fontWeight:700 }}>Wallet: ${fmt(myUser.walletBalance)} {!canAffordWallet&&"— use card below"}</div>
                <div style={{ fontSize:10,color:"#aaa",marginTop:4 }}>Only past sale payouts — not prepaid top-ups.</div>
              </div>
              {useWallet&&canAffordWallet&&<div style={{ width:20,height:20,borderRadius:"50%",background:"#00b894",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:"#fff" }}>✓</div>}
            </div>
            {myUser.paymentMethods.map(pm=>(
              <div key={pm.id} onClick={()=>{setUseWallet(false);setPayMethod(pm);}} style={{ background:(!useWallet&&payMethod?.id===pm.id)?"#EAF1FA":"#f9f9f9",border:`2px solid ${(!useWallet&&payMethod?.id===pm.id)?"#3A7BD5":"transparent"}`,borderRadius:16,padding:"14px 16px",marginBottom:10,cursor:"pointer",display:"flex",alignItems:"center",gap:12 }}>
                <div style={{ fontSize:24 }}>{pm.type==="paypal"?"💙":"💳"}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800,fontSize:13,color:"#2C3E50" }}>{pm.type==="paypal"?`PayPal · ${pm.email}`:`${pm.brand} ···· ${pm.last4}`}</div>
                  {pm.expiry&&<div style={{ fontSize:11,color:"#aaa" }}>Expires {pm.expiry}</div>}
                </div>
                {(!useWallet&&payMethod?.id===pm.id)&&<div style={{ width:20,height:20,borderRadius:"50%",background:"#3A7BD5",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:"#fff" }}>✓</div>}
              </div>
            ))}
            <div style={{ border:"1.5px dashed #ddd",borderRadius:16,padding:"12px 16px",marginBottom:20,display:"flex",alignItems:"center",gap:10,cursor:"pointer",color:"#aaa" }}>
              <span style={{ fontSize:20 }}>➕</span><span style={{ fontSize:13,fontWeight:600 }}>Add new card</span>
            </div>
            <Btn onClick={handleNext} style={{ background:"linear-gradient(135deg,#f9ca24,#f0932b)",color:"#fff",width:"100%" }}>Pay ${fmt(total)} sweetener →</Btn>
          </>
        )}

        {/* STEP: PIN */}
        {step==="pin" && (
          <>
            <div style={{ textAlign:"center",marginBottom:24 }}>
              <div style={{ fontSize:44,marginBottom:12 }}>🔒</div>
              <div style={{ fontWeight:700,fontSize:14,color:"#555" }}>Confirm your PIN</div>
              <div style={{ fontSize:11,color:"#aaa",marginTop:4 }}>Paying ${fmt(total)} sweetener · {useWallet?"Wallet":payMethod?`${payMethod.brand||"PayPal"} ····${payMethod.last4||""}`:"Card"}</div>
            </div>
            <div style={{ display:"flex",gap:10,justifyContent:"center",marginBottom:24 }}>
              {[0,1,2,3].map(i=>(
                <div key={i} style={{ width:52,height:60,borderRadius:14,background:pinError?"#fff0f0":"#f7f7f7",border:`2px solid ${pinError?"#ff6b6b":pin.length>i?"#2C3E50":"#DCE6F0"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,fontWeight:900,color:pinError?"#ff6b6b":"#2C3E50",transition:"all 0.2s" }}>
                  {pin.length>i?"●":""}
                </div>
              ))}
            </div>
            {pinError&&<div style={{ textAlign:"center",color:"#ff6b6b",fontSize:12,fontWeight:700,marginBottom:12 }}>Incorrect PIN. Try again.</div>}
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:12 }}>
              {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((k,i)=>(
                <button key={i} onClick={()=>{ if(!k) return; if(k==="⌫"){setPin(p=>p.slice(0,-1));} else if(pin.length<4){const np=pin+k; setPin(np); if(np.length===4) setTimeout(()=>handleNext(),120);} }} style={{ background:k?"#f7f7f7":"transparent",border:"none",borderRadius:14,padding:"16px",fontSize:20,fontWeight:700,color:"#2C3E50",cursor:k?"pointer":"default" }}>{k}</button>
              ))}
            </div>
            <div style={{ textAlign:"center",fontSize:11,color:"#ccc" }}>Hint: PIN is 1234</div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── ADD CARD / USER MODALS ───────────────────────────────────────────────────
// ─── PHOTO UTILITIES ─────────────────────────────────────────────────────────

// ── Compression ──────────────────────────────────────────────────────────────
// Dev note: swap compressImage() for a Cloudinary direct upload in production.
// Store the returned URL string instead of base64.
async function compressImage(file) {
  return new Promise((res, rej) => {
    const canvas = document.createElement("canvas");
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 1200;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
        else { width = Math.round(width * MAX / height); height = MAX; }
      }
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => blob ? res(blob) : rej(new Error("Compression failed")), "image/jpeg", 0.82);
    };
    img.onerror = rej;
    img.src = url;
  });
}

// ── Upload ────────────────────────────────────────────────────────────────────
// Dev: replace uploadPhoto with Cloudinary upload:
//   const form = new FormData();
//   form.append("file", compressedBlob);
//   form.append("upload_preset", "inhand_listings");
//   const res = await fetch("https://api.cloudinary.com/v1_1/YOUR_CLOUD/image/upload", { method:"POST", body:form });
//   const { secure_url } = await res.json();
//   return secure_url;   // store this URL instead of base64
async function uploadPhoto(file, onProgress) {
  // MOCK — simulates network upload with progress ticks
  const compressed = await compressImage(file);
  const originalKB = Math.round(file.size / 1024);
  const compressedKB = Math.round(compressed.size / 1024);
  console.log(`[Photo] Compressed ${originalKB}KB → ${compressedKB}KB`);

  // Simulate upload progress 0 → 100 over ~1.2s
  return new Promise((res) => {
    let pct = 0;
    const tick = setInterval(() => {
      pct = Math.min(pct + Math.random() * 25 + 10, 100);
      onProgress(Math.round(pct));
      if (pct >= 100) {
        clearInterval(tick);
        // Return base64 in demo — Cloudinary returns a URL in production
        const reader = new FileReader();
        reader.onload = () => res(reader.result);
        reader.readAsDataURL(compressed);
      }
    }, 200);
  });
}

// ─── PHOTO PICKER ────────────────────────────────────────────────────────────
function PhotoPicker({ photos, onChange, maxPhotos = 4 }) {
  const inputRef = useRef(null);
  const [dragging, setDragging]   = useState(false);
  const [uploading, setUploading] = useState([]); // [{ name, progress }]
  const [error, setError]         = useState("");

  const handleFiles = async (files) => {
    setError("");
    const valid = Array.from(files)
      .filter(f => f.type.startsWith("image/"))
      .slice(0, maxPhotos - photos.length);

    if (!valid.length) return;

    // Check file sizes before upload — warn if > 20MB
    const tooBig = valid.filter(f => f.size > 20 * 1024 * 1024);
    if (tooBig.length) { setError(`${tooBig.length} file(s) are too large. Max 20MB per photo.`); return; }

    // Start upload queue
    const uploadSlots = valid.map(f => ({ name: f.name, progress: 0 }));
    setUploading(uploadSlots);

    const results = await Promise.all(valid.map((file, i) =>
      uploadPhoto(file, (pct) => {
        setUploading(prev => prev.map((s, j) => j === i ? { ...s, progress: pct } : s));
      })
    ));

    setUploading([]);
    onChange([...photos, ...results].slice(0, maxPhotos));
  };

  const removePhoto = (i) => onChange(photos.filter((_, idx) => idx !== i));
  const moveLeft    = (i) => {
    if (i === 0) return;
    const p = [...photos]; [p[i-1], p[i]] = [p[i], p[i-1]]; onChange(p);
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
        <div style={{ fontSize:11, fontWeight:700, color:"#aaa", letterSpacing:0.8 }}>
          PHOTOS ({photos.length}/{maxPhotos}) · First photo is the cover
        </div>
        {photos.length > 0 && (
          <div style={{ fontSize:10, color:"#00b894", fontWeight:700 }}>
            ✓ {photos.length} uploaded
          </div>
        )}
      </div>

      {/* Photo grid */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>

        {/* Existing photos */}
        {photos.map((src, i) => (
          <div key={i} style={{ position:"relative", borderRadius:14, overflow:"hidden", aspectRatio:"1", background:"#E4EBF2", boxShadow: i===0?"0 0 0 2px #2C3E50":"none" }}>
            <img src={src} alt={`photo ${i+1}`} style={{ width:"100%", height:"100%", objectFit:"cover" }} />
            {i === 0 && (
              <div style={{ position:"absolute", top:6, left:6, background:"#2C3E50", borderRadius:6, fontSize:9, padding:"2px 7px", color:"#fff", fontWeight:700 }}>COVER</div>
            )}
            <div style={{ position:"absolute", top:6, right:6, display:"flex", gap:4 }}>
              {i > 0 && (
                <button onClick={()=>moveLeft(i)} title="Make cover" style={{ width:26, height:26, borderRadius:"50%", background:"rgba(255,255,255,0.92)", border:"none", fontSize:11, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>⬆</button>
              )}
              <button onClick={()=>removePhoto(i)} style={{ width:26, height:26, borderRadius:"50%", background:"rgba(255,255,255,0.92)", border:"none", fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:"#ff6b6b" }}>✕</button>
            </div>
          </div>
        ))}

        {/* Uploading slots */}
        {uploading.map((slot, i) => (
          <div key={`up-${i}`} style={{ borderRadius:14, background:"#EAF1FA", border:"2px solid #A8C8E8", aspectRatio:"1", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10, padding:12 }}>
            {/* Circular progress */}
            <div style={{ position:"relative", width:44, height:44 }}>
              <svg width="44" height="44" style={{ transform:"rotate(-90deg)" }}>
                <circle cx="22" cy="22" r="18" fill="none" stroke="#DCE6F0" strokeWidth="4" />
                <circle cx="22" cy="22" r="18" fill="none" stroke="#3A7BD5" strokeWidth="4"
                  strokeDasharray={`${2 * Math.PI * 18}`}
                  strokeDashoffset={`${2 * Math.PI * 18 * (1 - slot.progress / 100)}`}
                  strokeLinecap="round"
                  style={{ transition:"stroke-dashoffset 0.2s" }}
                />
              </svg>
              <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800, color:"#3A7BD5" }}>{slot.progress}%</div>
            </div>
            <div style={{ fontSize:10, color:"#888", fontWeight:600, textAlign:"center", lineHeight:1.3 }}>
              Uploading…<br/>
              <span style={{ color:"#aaa", fontWeight:400 }}>{slot.name.slice(0,16)}</span>
            </div>
          </div>
        ))}

        {/* Add photo tile */}
        {photos.length + uploading.length < maxPhotos && (
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
            style={{ borderRadius:14, border:`2px dashed ${dragging?"#3A7BD5":"#ddd"}`, background:dragging?"#EAF1FA":"#fafafa", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", aspectRatio:"1", cursor:"pointer", transition:"all 0.15s", gap:8 }}
          >
            <div style={{ fontSize:30 }}>📷</div>
            <div style={{ fontSize:11, fontWeight:700, color:"#aaa", textAlign:"center", lineHeight:1.4 }}>
              {photos.length === 0 ? "Add photos" : "Add more"}
            </div>
            <div style={{ fontSize:9, color:"#ccc", textAlign:"center" }}>Camera or gallery</div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ background:"#fff0f0", border:"1.5px solid #ff6b6b", borderRadius:10, padding:"8px 12px", marginBottom:8, fontSize:11, color:"#ff6b6b", fontWeight:600 }}>
          ⚠️ {error}
        </div>
      )}

      {/* Tips */}
      {photos.length === 0 && !uploading.length && (
        <div style={{ background:"#f9f9f9", borderRadius:12, padding:"10px 14px", marginBottom:8 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#555", marginBottom:6 }}>📸 Photo tips</div>
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            {["Good lighting — natural light works best","Front, back, and any damage or flaws","Include accessories and original packaging","Up to 4 photos · first one is the cover"].map((t,i)=>(
              <div key={i} style={{ display:"flex", gap:6, alignItems:"flex-start" }}>
                <span style={{ color:"#00b894", fontSize:10, marginTop:1 }}>✓</span>
                <span style={{ fontSize:11, color:"#888" }}>{t}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Compression + Cloudinary note */}
      {photos.length > 0 && (
        <div style={{ background:"#f0fff8", border:"1px solid #00b89422", borderRadius:10, padding:"8px 12px", marginBottom:8, display:"flex", gap:8, alignItems:"flex-start" }}>
          <span style={{ fontSize:14 }}>⚡</span>
          <div style={{ fontSize:10, color:"#00b894", fontWeight:600, lineHeight:1.4 }}>
            Photos compressed before upload · Max 500KB each
            <span style={{ display:"block", color:"#aaa", fontWeight:400, marginTop:2 }}>Dev: connect Cloudinary to store URLs instead of base64</span>
          </div>
        </div>
      )}

      <input
        ref={inputRef} type="file" accept="image/*" multiple
        style={{ display:"none" }}
        onChange={e => handleFiles(e.target.files)}
      />
    </div>
  );
}


// ─── PHOTO VIEWER MODAL ───────────────────────────────────────────────────────
function PhotoViewer({ photos, startIdx = 0, onClose }) {
  const [idx, setIdx] = useState(startIdx);
  if (!photos?.length) return null;
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.95)", zIndex:900, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
      <button onClick={onClose} style={{ position:"absolute", top:20, right:20, background:"rgba(255,255,255,0.15)", border:"none", borderRadius:"50%", width:40, height:40, color:"#fff", fontSize:20, cursor:"pointer" }}>✕</button>
      <img src={photos[idx]} alt={`Photo ${idx+1}`} style={{ maxWidth:"100%", maxHeight:"80vh", objectFit:"contain", borderRadius:12 }} />
      {/* Dots */}
      {photos.length > 1 && (
        <div style={{ display:"flex", gap:8, marginTop:20 }}>
          {photos.map((_, i) => (
            <div key={i} onClick={() => setIdx(i)} style={{ width:8, height:8, borderRadius:"50%", background:i===idx?"#fff":"rgba(255,255,255,0.35)", cursor:"pointer", transition:"background 0.2s" }} />
          ))}
        </div>
      )}
      {/* Prev / Next */}
      {photos.length > 1 && (
        <>
          <button onClick={()=>setIdx(i=>(i-1+photos.length)%photos.length)} style={{ position:"absolute", left:16, top:"50%", transform:"translateY(-50%)", background:"rgba(255,255,255,0.15)", border:"none", borderRadius:"50%", width:44, height:44, color:"#fff", fontSize:22, cursor:"pointer" }}>‹</button>
          <button onClick={()=>setIdx(i=>(i+1)%photos.length)} style={{ position:"absolute", right:16, top:"50%", transform:"translateY(-50%)", background:"rgba(255,255,255,0.15)", border:"none", borderRadius:"50%", width:44, height:44, color:"#fff", fontSize:22, cursor:"pointer" }}>›</button>
        </>
      )}
      <div style={{ marginTop:12, fontSize:12, color:"rgba(255,255,255,0.5)" }}>{idx+1} / {photos.length}</div>
    </div>
  );
}

// ─── ADD CARD MODAL ───────────────────────────────────────────────────────────
function AddCardModal({ onSave, onClose, ownerId }) {
  const [form, setForm] = useState({ name:"", brand:"Hasbro", line:"G.I. Joe", isNew:true, value:"", image:"🥷", photos:[], tags:"", description:"", videoUrl:"", wantsTrade:true, wantsBuy:false });
  const set = (k,v) => setForm(f => {
    const updated = {...f, [k]:v};
    if (k === "brand") updated.line = getLinesForBrand(v)[0] || "";
    return updated;
  });

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:500, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div style={{ background:"#fff", borderRadius:"24px 24px 0 0", padding:"24px 20px 36px", width:"100%", maxWidth:430, maxHeight:"92vh", overflowY:"auto" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
          <div style={{ fontWeight:800, fontSize:18, color:"#2C3E50" }}>Add to Vault</div>
          <button onClick={onClose} style={{ background:"#E4EBF2", border:"none", borderRadius:"50%", width:32, height:32, fontSize:16, cursor:"pointer" }}>✕</button>
        </div>

        {/* Photo upload */}
        <div style={{ marginBottom:16 }}>
          <PhotoPicker photos={form.photos} onChange={p=>set("photos",p)} maxPhotos={4} />
        </div>

        {/* Emoji fallback if no photos */}
        {form.photos.length === 0 && (
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#aaa", marginBottom:8 }}>OR CHOOSE AN EMOJI (if no photo)</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>{FIGURE_EMOJIS.map(e=><div key={e} onClick={()=>set("image",e)} style={{ width:36, height:36, borderRadius:10, background:form.image===e?"#2C3E50":"#E4EBF2", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, cursor:"pointer" }}>{e}</div>)}</div>
          </div>
        )}

        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <input value={form.name} onChange={e=>set("name",e.target.value)} placeholder="Figure name *" style={IS} />
          {/* Brand picker */}
          <div>
            <div style={{ fontSize:10,fontWeight:700,color:"#aaa",marginBottom:5,letterSpacing:0.8 }}>BRAND</div>
            <div style={{ display:"flex",gap:6,overflowX:"auto",paddingBottom:4 }}>
              {BRANDS.map(b=>(
                <button key={b.name} type="button" onClick={()=>set("brand",b.name)} style={{ flexShrink:0,background:form.brand===b.name?"#2C3E50":"#EEF2F7",border:"none",borderRadius:20,padding:"5px 13px",fontSize:11,fontWeight:700,color:form.brand===b.name?"#fff":"#888",cursor:"pointer",whiteSpace:"nowrap",transition:"all 0.15s" }}>
                  {b.name}
                </button>
              ))}
            </div>
          </div>
          {/* Custom figure details — shown when Custom brand selected */}
          {form.brand === "Custom" && (
            <div style={{ background:"#EAF1FA",borderRadius:12,padding:"12px 14px",display:"flex",gap:8,alignItems:"flex-start" }}>
              <span style={{ fontSize:18 }}>🎨</span>
              <div style={{ fontSize:11,color:"#3A7BD5",lineHeight:1.5,fontWeight:600 }}>
                Custom figures welcome! Use the description field to explain your build — base figure used, modifications, materials, paint work etc. Great photos are especially important for customs.
              </div>
            </div>
          )}
          {/* Line — filtered by brand */}
          <div>
            <div style={{ fontSize:10,fontWeight:700,color:"#aaa",marginBottom:5,letterSpacing:0.8 }}>TOY LINE</div>
            <select value={form.line} onChange={e=>set("line",e.target.value)} style={IS}>
              {getLinesForBrand(form.brand).map(l=><option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          {/* Condition */}
          <div style={{ display:"flex", borderRadius:12, overflow:"hidden", border:"1.5px solid #DCE6F0" }}>
            <button type="button" onClick={()=>set("isNew",true)} style={{ flex:1, background:form.isNew?"#2C3E50":"#EEF2F7", border:"none", padding:"10px 6px", fontSize:12, fontWeight:800, color:form.isNew?"#fff":"#aaa", cursor:"pointer" }}>📦 Brand New</button>
            <button type="button" onClick={()=>set("isNew",false)} style={{ flex:1, background:!form.isNew?"#2C3E50":"#EEF2F7", border:"none", padding:"10px 6px", fontSize:12, fontWeight:800, color:!form.isNew?"#fff":"#aaa", cursor:"pointer" }}>🔓 Used</button>
          </div>
          <input value={form.value} onChange={e=>set("value",e.target.value)} placeholder="Value in $ *" type="number" style={IS} />
          {/* Seller payout preview */}
          {form.value && form.wantsBuy && (
            <div style={{ background:"#f0fff8",border:"1.5px solid #00b89433",borderRadius:12,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
              <div>
                <div style={{ fontSize:11,fontWeight:700,color:"#00b894" }}>You receive after fees</div>
                <div style={{ fontSize:10,color:"#aaa",marginTop:2 }}>In Hand fee {(PLATFORM_FEE*100).toFixed(0)}% deducted on sale</div>
              </div>
              <div style={{ fontWeight:900,fontSize:18,color:"#00b894" }}>${fmt(parseFloat(form.value)*(1-PLATFORM_FEE))}</div>
            </div>
          )}
          {form.value && form.wantsTrade && (
            <div style={{ background:"#EAF1FA",border:"1.5px solid #3A7BD533",borderRadius:12,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
              <div>
                <div style={{ fontSize:11,fontWeight:700,color:"#3A7BD5" }}>Trade fee per party</div>
                <div style={{ fontSize:10,color:"#aaa",marginTop:2 }}>Flat $2.00 each · shipping split equally</div>
              </div>
              <div style={{ fontWeight:900,fontSize:18,color:"#3A7BD5" }}>${fmt(TRADE_FEE)}</div>
            </div>
          )}
          <input value={form.tags} onChange={e=>set("tags",e.target.value)} placeholder="Tags (vintage, hasbro, …)" style={IS} />
          <textarea value={form.description||""} onChange={e=>set("description",e.target.value)} placeholder="Description — condition details, accessories included, any flaws… (optional)" rows={3} style={{...IS, resize:"none", lineHeight:1.5}} />
          <div>
            <div style={{ fontSize:10,fontWeight:700,color:"#aaa",marginBottom:5,letterSpacing:0.8 }}>SHORT VIDEO (OPTIONAL)</div>
            <input value={form.videoUrl} onChange={e=>set("videoUrl",e.target.value)} placeholder="YouTube, Vimeo, or direct .mp4 / .webm link" style={IS} />
            <div style={{ fontSize:10,color:"#bbb",marginTop:4 }}>Shown as a play button on your listing. Keep clips short.</div>
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <label style={TS(form.wantsTrade)} onClick={()=>set("wantsTrade",!form.wantsTrade)}>⇄ Trade</label>
            <label style={TS(form.wantsBuy)} onClick={()=>set("wantsBuy",!form.wantsBuy)}>💰 For Sale</label>
          </div>
        </div>
        <Btn onClick={()=>{ if(!form.name||!form.value) return; onSave({...form, value:parseInt(form.value), tags:form.tags.split(",").map(t=>t.trim().toLowerCase()).filter(Boolean), id:"c"+Date.now(), ownerId: ownerId, listedAt:new Date().toISOString().split("T")[0], videoUrl:(form.videoUrl||"").trim()}); onClose(); }} style={{ background:"#2C3E50", color:"#fff", width:"100%", marginTop:16 }}>Save Figure</Btn>
      </div>
    </div>
  );
}


function AddUserModal({ onSave, onClose }) {
  const [form, setForm] = useState({ username:"", avatar:"🦖", location:"", wishlist:"" });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:500, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div style={{ background:"#fff", borderRadius:"24px 24px 0 0", padding:"24px 20px 36px", width:"100%", maxWidth:430 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
          <div style={{ fontWeight:800, fontSize:18, color:"#2C3E50" }}>Add User</div>
          <button onClick={onClose} style={{ background:"#E4EBF2", border:"none", borderRadius:"50%", width:32, height:32, fontSize:16, cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#aaa", marginBottom:8 }}>AVATAR</div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>{AVATARS.map(a=><div key={a} onClick={()=>set("avatar",a)} style={{ width:36, height:36, borderRadius:10, background:form.avatar===a?"#2C3E50":"#E4EBF2", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, cursor:"pointer" }}>{a}</div>)}</div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <input value={form.username} onChange={e=>set("username",e.target.value)} placeholder="Username *" style={IS} />
          <input value={form.location} onChange={e=>set("location",e.target.value)} placeholder="Location" style={IS} />
          <input value={form.wishlist} onChange={e=>set("wishlist",e.target.value)} placeholder="Wishlist tags" style={IS} />
        </div>
        <Btn onClick={()=>{ if(!form.username) return; onSave({...form, id:"u"+Date.now(), rating:5.0, tradesCompleted:0, joined:new Date().toISOString().split("T")[0], wishlist:form.wishlist.split(",").map(t=>t.trim().toLowerCase()).filter(Boolean), walletBalance:0, paymentMethods:[]}); onClose(); }} style={{ background:"#2C3E50", color:"#fff", width:"100%", marginTop:16 }}>Create User</Btn>
      </div>
    </div>
  );
}

// ─── FIGURE IMAGE ─────────────────────────────────────────────────────────────
// Shows real photo if available, falls back to emoji; optional short video (YouTube / Vimeo / mp4)
function FigureImage({ card, size=62, borderRadius=16, onClick, onVideoOpen, style={} }) {
  const { light } = lc(card.line);
  const hasPhotos = card.photos?.length > 0;
  const videoEmb = card.videoUrl ? getListingVideoEmbed(card.videoUrl) : null;
  return (
    <div onClick={onClick} style={{ width:size, height:size, borderRadius, background:light, flexShrink:0, overflow:"hidden", cursor:onClick?"pointer":"default", position:"relative", ...style }}>
      {hasPhotos
        ? <img src={card.photos[0]} alt={card.name} style={{ width:"100%", height:"100%", objectFit:"cover" }} />
        : <div className="inhand-figure-fallback">{figureInitials(card.name)}</div>
      }
      {hasPhotos && card.photos.length > 1 && (
        <div style={{ position:"absolute", bottom:4, right:4, background:"rgba(0,0,0,0.6)", borderRadius:6, fontSize:9, color:"#fff", padding:"1px 5px", fontWeight:700 }}>+{card.photos.length-1}</div>
      )}
      {videoEmb && (
        <button
          type="button"
          aria-label="Play short listing video"
          onClick={(e) => { e.stopPropagation(); onVideoOpen?.(); }}
          style={{ position:"absolute", top:4, left:4, width:26, height:26, borderRadius:"50%", border:"none", background:"rgba(0,0,0,0.68)", color:"#fff", fontSize:10, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", paddingLeft:2, boxShadow:"0 2px 8px rgba(0,0,0,0.25)" }}
        >
          ▶
        </button>
      )}
    </div>
  );
}

// ─── SWIPE CARD ───────────────────────────────────────────────────────────────
function SwipeCard({ card, owner, matchScore, onSwipe, isTop, stackIndex, onOpenVideo }) {
  const [drag, setDrag] = useState({ x:0, y:0, dragging:false }); const [decision, setDecision] = useState(null); const startRef = useRef(null);
  const hs = (x,y) => { startRef.current={x,y}; setDrag(d=>({...d,dragging:true})); };
  const hm = (x,y) => { if(!drag.dragging||!startRef.current) return; const dx=x-startRef.current.x,dy=y-startRef.current.y; setDrag({x:dx,y:dy,dragging:true}); setDecision(dx>60?"yes":dx<-60?"no":null); };
  const he = () => { if(!drag.dragging) return; if(drag.x>100){onSwipe("yes");return;} if(drag.x<-100){onSwipe("no");return;} setDrag({x:0,y:0,dragging:false}); setDecision(null); startRef.current=null; };
  const {from,to} = lc(card.line); const sc = matchScore>=85?"#00b894":matchScore>=70?"#f9ca24":"#4A90D9";
  return (
    <div onMouseDown={isTop?e=>hs(e.clientX,e.clientY):undefined} onMouseMove={isTop&&drag.dragging?e=>hm(e.clientX,e.clientY):undefined} onMouseUp={isTop?he:undefined} onMouseLeave={isTop&&drag.dragging?he:undefined} onTouchStart={isTop?e=>hs(e.touches[0].clientX,e.touches[0].clientY):undefined} onTouchMove={isTop?e=>{e.preventDefault();hm(e.touches[0].clientX,e.touches[0].clientY);}:undefined} onTouchEnd={isTop?he:undefined}
      style={{ position:"absolute", width:"100%", transform:isTop?`translate(${drag.x}px,${drag.y*.25}px) rotate(${drag.x/18}deg)`:`translateY(${stackIndex*10}px) scale(${Math.max(.88,1-stackIndex*.045)})`, transition:drag.dragging?"none":"transform 0.35s cubic-bezier(.25,.8,.25,1)", cursor:isTop?(drag.dragging?"grabbing":"grab"):"default", userSelect:"none", zIndex:10-stackIndex, opacity:isTop?1:Math.max(0,1-stackIndex*.12) }}>
      <div style={{ background:`linear-gradient(155deg,${from},${to})`, borderRadius:26, overflow:"hidden", boxShadow:isTop?"0 20px 60px rgba(0,0,0,0.18)":"0 8px 24px rgba(0,0,0,0.1)", minHeight:460, position:"relative" }}>
        {isTop&&decision==="yes"&&<div style={{ position:"absolute",inset:0,background:"rgba(0,184,148,0.22)",borderRadius:26,zIndex:10,display:"flex",alignItems:"center",justifyContent:"center",border:"4px solid #00b894" }}><div style={{ fontWeight:900,fontSize:54,color:"#00b894",transform:"rotate(-12deg)" }}>TRADE!</div></div>}
        {isTop&&decision==="no"&&<div style={{ position:"absolute",inset:0,background:"rgba(253,121,168,0.22)",borderRadius:26,zIndex:10,display:"flex",alignItems:"center",justifyContent:"center",border:"4px solid #4A90D9" }}><div style={{ fontWeight:900,fontSize:54,color:"#4A90D9",transform:"rotate(12deg)" }}>PASS</div></div>}
        {card.photos?.length > 0 ? (
          <div style={{ height:220, overflow:"hidden", position:"relative" }}>
            <img src={card.photos[0]} alt={card.name} style={{ width:"100%", height:"100%", objectFit:"cover" }} />
            {card.photos.length > 1 && <div style={{ position:"absolute", bottom:10, left:"50%", transform:"translateX(-50%)", display:"flex", gap:5 }}>{card.photos.map((_,i)=><div key={i} style={{ width:6,height:6,borderRadius:"50%",background:i===0?"#fff":"rgba(255,255,255,0.5)" }} />)}</div>}
            <div style={{ position:"absolute", bottom:0, left:0, right:0, height:60, background:"linear-gradient(transparent,rgba(0,0,0,0.3))" }} />
            <div style={{ position:"absolute", top:10, left:"50%", transform:"translateX(-50%)", background:"rgba(255,255,255,0.2)", borderRadius:10, padding:"3px 12px", fontSize:10, color:"#fff", fontWeight:700, letterSpacing:1.2, backdropFilter:"blur(8px)" }}>{card.line.toUpperCase()}</div>
            {isTop && getListingVideoEmbed(card.videoUrl) && (
              <button
                type="button"
                aria-label="Play listing video"
                onClick={(e) => { e.stopPropagation(); onOpenVideo?.(); }}
                style={{ position:"absolute", bottom:12, right:12, width:44, height:44, borderRadius:"50%", border:"none", background:"rgba(0,0,0,0.55)", color:"#fff", fontSize:18, cursor:"pointer", boxShadow:"0 4px 16px rgba(0,0,0,0.35)" }}
              >
                ▶
              </button>
            )}
          </div>
        ) : (
          <div style={{ padding:"32px 24px 16px", textAlign:"center", position:"relative" }}><div style={{ fontSize:100,lineHeight:1,filter:"drop-shadow(0 8px 24px rgba(0,0,0,0.2))",marginBottom:10 }}>{card.image}</div><div style={{ background:"rgba(255,255,255,0.2)",borderRadius:10,display:"inline-block",padding:"3px 12px",fontSize:10,color:"#fff",fontWeight:700,letterSpacing:1.2 }}>{card.line.toUpperCase()}</div>
            {isTop && getListingVideoEmbed(card.videoUrl) && (
              <button type="button" aria-label="Play listing video" onClick={(e) => { e.stopPropagation(); onOpenVideo?.(); }} style={{ position:"absolute", bottom:16, right:16, width:44, height:44, borderRadius:"50%", border:"none", background:"rgba(0,0,0,0.55)", color:"#fff", fontSize:18, cursor:"pointer" }}>▶</button>
            )}
          </div>
        )}
        <div style={{ background:"rgba(255,255,255,0.96)", borderRadius:"20px 20px 26px 26px", padding:"18px 20px 24px" }}>
          <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:12 }}>
            <div><div style={{ fontWeight:800,fontSize:19,color:"#2C3E50",lineHeight:1.15 }}>{card.name}</div><div style={{ fontSize:12,color:"#aaa",marginTop:3 }}><span style={{ fontWeight:700,color:"#555" }}>{condLabel(card.isNew)}</span> · <span style={{ fontWeight:800,color:from }}>${card.value}</span></div>
            {card.description && <div style={{ fontSize:12,color:"#666",marginTop:5,lineHeight:1.4 }}>{card.description}</div>}
            <div style={{ marginTop:5 }}><MarketBadge name={card.name} value={card.value} isNew={card.isNew} /></div>
            </div>
            <div style={{ textAlign:"center" }}><div style={{ width:48,height:48,borderRadius:"50%",background:`conic-gradient(${sc} ${matchScore*3.6}deg,#E4EBF2 0)`,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:`0 0 0 3px #fff,0 0 0 4px ${sc}33` }}><div style={{ width:36,height:36,borderRadius:"50%",background:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:13,color:sc }}>{matchScore}</div></div><div style={{ fontSize:8,fontWeight:700,color:sc,marginTop:3,letterSpacing:.5 }}>MATCH</div></div>
          </div>
          <div style={{ display:"flex",gap:5,flexWrap:"wrap",marginBottom:card.photos?.length>1?8:12 }}>{card.tags.map(t=><span key={t} style={{ fontSize:10,background:`${from}15`,color:from,borderRadius:20,padding:"2px 9px",fontWeight:700 }}>#{t}</span>)}</div>
          {card.photos?.length > 1 && (
            <div style={{ display:"flex",gap:6,marginBottom:12,overflowX:"auto" }}>
              {card.photos.map((p,i)=>(
                <div key={i} style={{ width:48,height:48,borderRadius:10,overflow:"hidden",flexShrink:0,border:i===0?"2px solid #2C3E50":"2px solid transparent" }}>
                  <img src={p} alt={`photo ${i+1}`} style={{ width:"100%",height:"100%",objectFit:"cover" }} />
                </div>
              ))}
            </div>
          )}
          <div style={{ display:"flex",alignItems:"center",gap:10,background:"#f7f7ff",borderRadius:12,padding:"9px 12px" }}>
            <span style={{ fontSize:24 }}>{owner.avatar}</span>
            <div style={{ minWidth:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                <span style={{ fontWeight:800,fontSize:12,color:"#2C3E50" }}>{owner.username}</span>
                {owner.verified && <VerifiedInHandBadge compact />}
              </div>
              <div style={{ fontSize:10,color:"#bbb" }}>⭐ {owner.rating} · {owner.tradesCompleted} trades · {owner.location}</div>
            </div>
            <div style={{ marginLeft:"auto",display:"flex",gap:5 }}>{card.wantsTrade&&<span style={{ fontSize:9,background:"#e8fff6",color:"#00b894",borderRadius:6,padding:"2px 7px",fontWeight:700 }}>TRADE</span>}{card.wantsBuy&&<span style={{ fontSize:9,background:"#fff8e6",color:"#f9ca24",borderRadius:6,padding:"2px 7px",fontWeight:700 }}>BUY</span>}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── LABEL GENERATION MODAL ───────────────────────────────────────────────────
function LabelModal({ shipment, rate, seller, buyer, sellerAddresses, onGenerate, onClose }) {
  const [step, setStep] = useState("details");
  const [showPackagingGuide, setShowPackagingGuide] = useState(false);
  const defaultAddr = sellerAddresses?.find(a=>a.isDefault) || sellerAddresses?.[0] || null;
  const [selectedAddrId, setSelectedAddrId] = useState(defaultAddr?.id || null);
  const [fromAddr, setFromAddr] = useState({
    name:   defaultAddr?.name   || seller?.username || "",
    street: defaultAddr?.street || "",
    city:   defaultAddr?.city   || seller?.location?.split(",")[0]?.trim() || "",
    state:  defaultAddr?.state  || seller?.location?.split(",")[1]?.trim() || "",
    zip:    defaultAddr?.zip    || "",
  });
  const [toAddr] = useState({ name: buyer?.username || "", city: buyer?.location || "On file" });
  const [generatedTN, setGeneratedTN] = useState("");
  const [labelUrl, setLabelUrl] = useState("");
  const [generateError, setGenerateError] = useState("");
  const buyerShipAddr = buyer?.addresses?.find((a) => a.isDefault) || buyer?.addresses?.[0];
  const buyerAddressReady = !!(
    buyerShipAddr?.street && buyerShipAddr?.city && buyerShipAddr?.state && buyerShipAddr?.zip
  );
  const setF = (k, v) => setFromAddr(a => ({...a, [k]: v}));

  const pickSavedAddr = (addr) => {
    setSelectedAddrId(addr.id);
    setFromAddr({ name:addr.name, street:addr.street, city:addr.city, state:addr.state, zip:addr.zip });
  };

  const handleGenerate = async () => {
    setGenerateError("");
    setStep("generating");
    try {
      if (supabase) {
        const result = await createShippingLabel({
          shipmentId: shipment.id,
          fromAddress: fromAddr,
        });
        setGeneratedTN(result.trackingNumber || "");
        setLabelUrl(result.labelUrl || "");
        setStep("done");
        return;
      }
      setTimeout(() => {
        const tn = "9400111899" + Math.floor(Math.random() * 9000000000000 + 1000000000000);
        setGeneratedTN(tn);
        setStep("done");
      }, 1500);
    } catch (err) {
      setStep("confirm");
      setGenerateError(err?.message || "Could not generate label");
    }
  };

  const uspsRedUrl = `https://tools.usps.com/go/TrackConfirmAction?tLabels=${generatedTN}`;

  return (
    <>
    {showPackagingGuide && (
      <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:900,display:"flex",alignItems:"flex-end",justifyContent:"center" }}>
        <div style={{ background:"#fff",borderRadius:"28px 28px 0 0",padding:"24px 20px 44px",width:"100%",maxWidth:430,maxHeight:"85vh",overflowY:"auto" }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18 }}>
            <div style={{ fontWeight:800,fontSize:18,color:"#2C3E50" }}>📦 Packaging Guidelines</div>
            <button onClick={()=>setShowPackagingGuide(false)} style={{ background:"#E4EBF2",border:"none",borderRadius:"50%",width:32,height:32,fontSize:16,cursor:"pointer" }}>✕</button>
          </div>
          {shipment?.figureValue > 100 && (
            <div style={{ background:"#f0fff8",border:"2px solid #00b894",borderRadius:14,padding:"12px 14px",marginBottom:16,display:"flex",gap:8 }}>
              <span style={{ fontSize:18 }}>🛡️</span>
              <div>
                <div style={{ fontWeight:700,fontSize:12,color:"#00b894" }}>USPS Insurance included on this shipment</div>
                <div style={{ fontSize:11,color:"#555",marginTop:2 }}>Keep your receipt and photos of the packaged item. You'll need them for any damage claim.</div>
              </div>
            </div>
          )}
          {[
            { icon:"📸", title:"Photograph before packing",   tip:"Take clear photos of the figure and open box before sealing. These are your evidence if damage occurs." },
            { icon:"🫧", title:"Wrap in bubble wrap first",   tip:"At least 2 layers of bubble wrap. For carded figures wrap the entire card. For boxed items wrap the box itself." },
            { icon:"📦", title:"Double box high-value items", tip:"For figures over $150 put the wrapped item in a smaller box then place inside the shipping box with packing peanuts." },
            { icon:"📰", title:"No newspaper padding",        tip:"Newspaper ink transfers and stains figures. Use bubble wrap, foam, or packing peanuts only." },
            { icon:"🧲", title:"Bag loose accessories",       tip:"Put accessories in a zip-lock bag and tape it securely to the figure. Never let small parts rattle loose." },
            { icon:"📮", title:"Seal all edges",              tip:"Tape every seam with packing tape. The box should not flex or open under pressure." },
            { icon:"🏷️", title:"Waterproof your label",       tip:"Cover the label with clear tape. Put a second label inside the box in case the exterior one falls off." },
          ].map((item,i)=>(
            <div key={i} style={{ display:"flex",gap:12,marginBottom:14,paddingBottom:14,borderBottom:i<6?"1px solid #f5f5f5":"none" }}>
              <div style={{ fontSize:22,flexShrink:0,width:28,textAlign:"center" }}>{item.icon}</div>
              <div>
                <div style={{ fontWeight:700,fontSize:13,color:"#2C3E50",marginBottom:3 }}>{item.title}</div>
                <div style={{ fontSize:11,color:"#888",lineHeight:1.5 }}>{item.tip}</div>
              </div>
            </div>
          ))}
          <Btn onClick={()=>setShowPackagingGuide(false)} style={{ background:"#2C3E50",color:"#fff",width:"100%" }}>Got it — ready to ship ✓</Btn>
        </div>
      </div>
    )}
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:600,display:"flex",alignItems:"flex-end",justifyContent:"center" }}>
      <div style={{ background:"#fff",borderRadius:"28px 28px 0 0",padding:"24px 20px 40px",width:"100%",maxWidth:430,maxHeight:"90vh",overflowY:"auto" }}>

        {/* Header */}
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20 }}>
          <div>
            <div style={{ fontWeight:800,fontSize:18,color:"#2C3E50" }}>
              {step==="done" ? "🏷️ Label Ready!" : "🏷️ Generate Shipping Label"}
            </div>
            <div style={{ fontSize:11,color:"#aaa",marginTop:2 }}>Powered by Shippo + USPS</div>
          </div>
          <button onClick={onClose} style={{ background:"#E4EBF2",border:"none",borderRadius:"50%",width:32,height:32,fontSize:16,cursor:"pointer" }}>✕</button>
        </div>

        {/* STEP: DETAILS */}
        {step==="details" && (
          <>
            {/* Shipment summary */}
            <div style={{ background:"#f9f9f9",borderRadius:16,padding:"14px",marginBottom:16 }}>
              <div style={{ fontWeight:700,fontSize:12,color:"#aaa",marginBottom:10,letterSpacing:0.8 }}>SHIPMENT SUMMARY</div>
              <div style={{ display:"flex",justifyContent:"space-between",marginBottom:6 }}>
                <span style={{ fontSize:13,color:"#555" }}>Item</span>
                <span style={{ fontSize:13,fontWeight:700,color:"#2C3E50" }}>{shipment.figureName}</span>
              </div>
              <div style={{ display:"flex",justifyContent:"space-between",marginBottom:6 }}>
                <span style={{ fontSize:13,color:"#555" }}>Service</span>
                <span style={{ fontSize:13,fontWeight:700,color:"#2C3E50" }}>USPS Ground Advantage</span>
              </div>
              <div style={{ display:"flex",justifyContent:"space-between",marginBottom:6 }}>
                <span style={{ fontSize:13,color:"#555" }}>Box</span>
                <span style={{ fontSize:13,fontWeight:700,color:"#2C3E50" }}>{rate?.label}</span>
              </div>
              <div style={{ display:"flex",justifyContent:"space-between",borderTop:"1px solid #ebebeb",paddingTop:8,marginTop:4 }}>
                <span style={{ fontSize:13,fontWeight:700,color:"#2C3E50" }}>Label cost</span>
                <span style={{ fontSize:14,fontWeight:900,color:"#00b894" }}>${rate?.price.toFixed(2)}</span>
              </div>
            </div>

            {/* Destination (read only) */}
            <div style={{ background:"#f0fff8",border:"1.5px solid #00b89433",borderRadius:14,padding:"12px 14px",marginBottom:16 }}>
              <div style={{ fontWeight:700,fontSize:11,color:"#00b894",marginBottom:8,letterSpacing:0.8 }}>SHIPPING TO</div>
              <div style={{ fontWeight:800,fontSize:13,color:"#2C3E50" }}>{toAddr.name}</div>
              <div style={{ fontSize:11,color:"#aaa",marginTop:2 }}>
                {buyerAddressReady
                  ? `${buyerShipAddr.street}, ${buyerShipAddr.city}, ${buyerShipAddr.state} ${buyerShipAddr.zip}`
                  : `Address on file · ${toAddr.city}`}
              </div>
              {!buyerAddressReady && supabase && (
                <div style={{ fontSize:10,color:"#ff6b6b",marginTop:6,fontWeight:600 }}>
                  Buyer must add a full shipping address in Account → Addresses before you can generate a label.
                </div>
              )}
            </div>

            {/* Saved address picker */}
            {sellerAddresses?.length > 0 && (
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:11,fontWeight:700,color:"#aaa",marginBottom:8,letterSpacing:0.8 }}>USE SAVED ADDRESS</div>
                <div style={{ display:"flex",gap:8 }}>
                  {sellerAddresses.map(addr => (
                    <div key={addr.id} onClick={()=>pickSavedAddr(addr)} style={{ flex:1,background:selectedAddrId===addr.id?"#2C3E50":"#EEF2F7",borderRadius:14,padding:"10px 12px",cursor:"pointer",border:`2px solid ${selectedAddrId===addr.id?"#2C3E50":"transparent"}`,transition:"all 0.15s" }}>
                      <div style={{ fontSize:16,marginBottom:4 }}>{addr.label==="Home"?"🏠":addr.label==="Work"?"🏢":addr.label==="Storage"?"📦":"📍"}</div>
                      <div style={{ fontWeight:800,fontSize:12,color:selectedAddrId===addr.id?"#fff":"#2C3E50" }}>{addr.label}</div>
                      <div style={{ fontSize:10,color:selectedAddrId===addr.id?"rgba(255,255,255,0.6)":"#aaa",marginTop:2,lineHeight:1.3 }}>{addr.street}<br/>{addr.city}, {addr.state}</div>
                      {addr.isDefault && <div style={{ fontSize:8,background:selectedAddrId===addr.id?"rgba(255,255,255,0.2)":"#e8fff6",color:selectedAddrId===addr.id?"#fff":"#00b894",borderRadius:4,padding:"1px 6px",marginTop:4,display:"inline-block",fontWeight:700 }}>DEFAULT</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Return address form */}
            <div style={{ fontWeight:700,fontSize:11,color:"#aaa",marginBottom:8,letterSpacing:0.8 }}>{sellerAddresses?.length>0?"OR ENTER MANUALLY":"YOUR RETURN ADDRESS"}</div>
            <div style={{ display:"flex",flexDirection:"column",gap:8,marginBottom:20 }}>
              <input value={fromAddr.name} onChange={e=>setF("name",e.target.value)} placeholder="Full name *" style={IS} />
              <input value={fromAddr.street} onChange={e=>setF("street",e.target.value)} placeholder="Street address *" style={IS} />
              <div style={{ display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:8 }}>
                <input value={fromAddr.city} onChange={e=>setF("city",e.target.value)} placeholder="City *" style={IS} />
                <input value={fromAddr.state} onChange={e=>setF("state",e.target.value)} placeholder="State *" maxLength={2} style={IS} />
                <input value={fromAddr.zip} onChange={e=>setF("zip",e.target.value)} placeholder="ZIP *" maxLength={5} style={IS} />
              </div>
            </div>

            {/* Shippo notice */}
            <div style={{ background:"#EAF1FA",borderRadius:14,padding:"12px 14px",marginBottom:20,display:"flex",gap:10 }}>
              <span style={{ fontSize:20 }}>⚡</span>
              <div>
                <div style={{ fontWeight:700,fontSize:12,color:"#3A7BD5" }}>Shippo labels</div>
                <div style={{ fontSize:11,color:"#888",marginTop:2 }}>Buyer already paid USPS shipping at checkout. In Hand purchases the label through Shippo (goshippo.com); cost is covered from escrow.</div>
              </div>
            </div>

            <Btn
              onClick={() => { if(fromAddr.name && fromAddr.street && fromAddr.zip) setStep("confirm"); }}
              style={{ background:"#2C3E50",color:"#fff",width:"100%" }}
            >Review & Generate Label →</Btn>
          </>
        )}

        {/* STEP: CONFIRM */}
        {step==="confirm" && (
          <>
            <div style={{ background:"#f9f9f9",borderRadius:16,padding:"16px",marginBottom:16 }}>
              <div style={{ fontWeight:700,fontSize:12,color:"#aaa",marginBottom:12,letterSpacing:0.8 }}>CONFIRM DETAILS</div>
              {[
                ["From", `${fromAddr.name}, ${fromAddr.street}, ${fromAddr.city} ${fromAddr.state} ${fromAddr.zip}`],
                ["To",   `${toAddr.name} (address on file)`],
                ["Service", "USPS Ground Advantage"],
                ["Package", rate?.label],
                ["Label cost", `$${rate?.price.toFixed(2)} (from escrow)`],
              ].map(([l,v]) => (
                <div key={l} style={{ display:"flex",justifyContent:"space-between",marginBottom:10,gap:12 }}>
                  <span style={{ fontSize:12,color:"#aaa",flexShrink:0 }}>{l}</span>
                  <span style={{ fontSize:12,fontWeight:700,color:"#2C3E50",textAlign:"right" }}>{v}</span>
                </div>
              ))}
            </div>
            {generateError && (
              <div style={{ background:"#fff0f0",borderRadius:12,padding:"12px 14px",marginBottom:12,fontSize:12,color:"#ff6b6b",fontWeight:600 }}>
                {generateError}
              </div>
            )}
            <div style={{ background:"#fff8e6",borderRadius:12,padding:"12px 14px",marginBottom:12,fontSize:12,color:"#f0932b",fontWeight:600 }}>
              ⚠️ Once generated, the label cost is non-refundable. Make sure the item is packaged and ready to ship.
            </div>
            {/* Packaging guide link */}
            <div onClick={()=>setShowPackagingGuide&&setShowPackagingGuide(true)} style={{ background:"#EAF1FA",borderRadius:12,padding:"10px 14px",marginBottom:16,display:"flex",alignItems:"center",gap:8,cursor:"pointer" }}>
              <span style={{ fontSize:18 }}>📦</span>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700,fontSize:12,color:"#3A7BD5" }}>Packaging Guidelines</div>
                <div style={{ fontSize:11,color:"#888" }}>Tap to review before you ship — items over $100 include USPS insurance</div>
              </div>
              <span style={{ fontSize:14,color:"#3A7BD5" }}>›</span>
            </div>
            <div style={{ display:"flex",gap:8 }}>
              <button onClick={()=>setStep("details")} style={{ flex:1,background:"#EEF2F7",border:"none",borderRadius:12,padding:"12px",fontWeight:700,fontSize:13,color:"#555",cursor:"pointer" }}>← Back</button>
              <Btn
                onClick={handleGenerate}
                style={{ flex:2,background:"linear-gradient(135deg,#2C3E50,#2d3561)",color:"#fff",opacity:supabase && !buyerAddressReady ? 0.5 : 1 }}
                disabled={supabase && !buyerAddressReady}
              >Generate Label ✓</Btn>
            </div>
          </>
        )}

        {/* STEP: GENERATING */}
        {step==="generating" && (
          <div style={{ textAlign:"center",padding:"40px 0" }}>
            <div style={{ fontSize:52,marginBottom:16 }}>📡</div>
            <div style={{ fontWeight:800,fontSize:16,color:"#2C3E50",marginBottom:8 }}>Contacting Shippo…</div>
            <div style={{ fontSize:12,color:"#aaa",marginBottom:24 }}>Generating your USPS Ground Advantage label</div>
            <div style={{ display:"flex",justifyContent:"center",gap:6 }}>
              {[0,1,2].map(i=><div key={i} style={{ width:8,height:8,borderRadius:"50%",background:"#3A7BD5",animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
            </div>
            <style>{`@keyframes pulse{0%,100%{opacity:0.3;transform:scale(0.8)}50%{opacity:1;transform:scale(1.2)}}`}</style>
          </div>
        )}

        {/* STEP: DONE */}
        {step==="done" && (
          <>
            <div style={{ textAlign:"center",marginBottom:20 }}>
              <div style={{ fontSize:52,marginBottom:12 }}>✅</div>
              <div style={{ fontWeight:800,fontSize:18,color:"#2C3E50",marginBottom:4 }}>Label Generated!</div>
              <div style={{ fontSize:12,color:"#aaa" }}>Your prepaid USPS label is ready</div>
            </div>

            {/* Fake label preview */}
            <div style={{ background:"#fff",border:"2px dashed #2C3E50",borderRadius:16,padding:"16px",marginBottom:16,fontFamily:"monospace" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12 }}>
                <div>
                  <div style={{ fontWeight:900,fontSize:13,color:"#2C3E50" }}>USPS GROUND ADVANTAGE</div>
                  <div style={{ fontSize:10,color:"#aaa",marginTop:2 }}>Prepaid · {rate?.label}</div>
                </div>
                <div style={{ fontSize:28 }}>📮</div>
              </div>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12 }}>
                <div>
                  <div style={{ fontSize:9,color:"#aaa",fontWeight:700,letterSpacing:1 }}>FROM</div>
                  <div style={{ fontSize:11,color:"#2C3E50",marginTop:3,lineHeight:1.4 }}>{fromAddr.name}<br/>{fromAddr.street}<br/>{fromAddr.city}, {fromAddr.state} {fromAddr.zip}</div>
                </div>
                <div>
                  <div style={{ fontSize:9,color:"#aaa",fontWeight:700,letterSpacing:1 }}>TO</div>
                  <div style={{ fontSize:11,color:"#2C3E50",marginTop:3,lineHeight:1.4 }}>{toAddr.name}<br/>Address on file</div>
                </div>
              </div>
              {/* Barcode simulation */}
              <div style={{ background:"#2C3E50",borderRadius:6,padding:"8px 10px",marginBottom:8,display:"flex",flexDirection:"column",gap:3,alignItems:"center" }}>
                <div style={{ display:"flex",gap:1 }}>
                  {Array.from({length:60}).map((_,i)=><div key={i} style={{ width:Math.random()>0.5?2:1,height:24,background:"#fff",opacity:Math.random()>0.2?1:0.3 }} />)}
                </div>
                <div style={{ fontSize:9,color:"rgba(255,255,255,0.7)",letterSpacing:2,marginTop:4 }}>{generatedTN}</div>
              </div>
              <div style={{ fontSize:9,color:"#aaa",textAlign:"center" }}>Label cost ${rate?.price.toFixed(2)} deducted from escrow</div>
            </div>

            {/* Actions */}
            <div style={{ display:"flex",flexDirection:"column",gap:10,marginBottom:16 }}>
              <button onClick={()=>{ window.open(labelUrl || `https://tools.usps.com/go/TrackConfirmAction?tLabels=${generatedTN}`,"_blank"); }} style={{ background:"#2C3E50",border:"none",borderRadius:14,padding:"13px",fontWeight:800,fontSize:14,color:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
                🖨️ {labelUrl ? "Open Label PDF" : "Track on USPS"}
              </button>
              <button onClick={()=>{ navigator.clipboard?.writeText(generatedTN); }} style={{ background:"#EAF1FA",border:"none",borderRadius:14,padding:"12px",fontWeight:700,fontSize:13,color:"#3A7BD5",cursor:"pointer" }}>
                📋 Copy Tracking Number
              </button>
            </div>

            {/* Drop-off instructions */}
            <div style={{ background:"#f0fff8",border:"1.5px solid #00b89433",borderRadius:14,padding:"14px",marginBottom:20 }}>
              <div style={{ fontWeight:700,fontSize:12,color:"#00b894",marginBottom:8 }}>📦 Next Steps</div>
              {[
                "Pack the figure securely with bubble wrap",
                "Attach the printed label to the outside of the box",
                "Drop off at any USPS location or schedule a free pickup at usps.com",
                "Tracking updates automatically — buyer gets notified",
              ].map((step,i) => (
                <div key={i} style={{ display:"flex",gap:8,marginBottom:6,alignItems:"flex-start" }}>
                  <div style={{ width:18,height:18,borderRadius:"50%",background:"#00b894",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"#fff",fontWeight:800,flexShrink:0,marginTop:1 }}>{i+1}</div>
                  <div style={{ fontSize:12,color:"#555" }}>{step}</div>
                </div>
              ))}
            </div>

            <Btn onClick={()=>{ onGenerate(generatedTN); onClose(); }} style={{ background:"#00b894",color:"#fff",width:"100%" }}>
              Done — I've Shipped It ✓
            </Btn>
          </>
        )}
      </div>
    </div>
    </>
  );
}
function AddressModal({ addresses, onSave, onClose }) {
  const [list, setList] = useState(addresses || []);
  const [editing, setEditing] = useState(null); // null | "new" | address id
  const [form, setForm] = useState({ label:"Home", name:"", street:"", city:"", state:"", zip:"" });
  const setF = (k, v) => setForm(f => ({...f, [k]: v}));

  const openNew = () => {
    setForm({ label:"Home", name:"", street:"", city:"", state:"", zip:"" });
    setEditing("new");
  };
  const openEdit = (addr) => {
    setForm({ label:addr.label, name:addr.name, street:addr.street, city:addr.city, state:addr.state, zip:addr.zip });
    setEditing(addr.id);
  };
  const saveForm = () => {
    if (!form.name || !form.street || !form.zip) return;
    if (editing === "new") {
      const newAddr = { ...form, id:"a"+Date.now(), isDefault: list.length === 0 };
      if (list.length >= 2) { alert("Maximum 2 addresses allowed."); return; }
      setList(l => [...l, newAddr]);
    } else {
      setList(l => l.map(a => a.id === editing ? {...a, ...form} : a));
    }
    setEditing(null);
  };
  const deleteAddr = (id) => {
    setList(l => {
      const filtered = l.filter(a => a.id !== id);
      // if deleted was default, make first remaining the default
      if (l.find(a=>a.id===id)?.isDefault && filtered.length > 0) filtered[0].isDefault = true;
      return filtered;
    });
  };
  const setDefault = (id) => setList(l => l.map(a => ({...a, isDefault: a.id === id})));

  const LABELS = ["Home", "Work", "Storage", "Other"];

  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:600,display:"flex",alignItems:"flex-end",justifyContent:"center" }}>
      <div style={{ background:"#fff",borderRadius:"28px 28px 0 0",padding:"24px 20px 44px",width:"100%",maxWidth:430,maxHeight:"85vh",overflowY:"auto" }}>

        {/* Header */}
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20 }}>
          <div>
            <div style={{ fontWeight:800,fontSize:18,color:"#2C3E50" }}>
              {editing ? (editing==="new" ? "Add Address" : "Edit Address") : "📍 My Addresses"}
            </div>
            {!editing && <div style={{ fontSize:11,color:"#aaa",marginTop:2 }}>Up to 2 addresses — used for shipping labels</div>}
          </div>
          <button onClick={editing ? ()=>setEditing(null) : onClose} style={{ background:"#E4EBF2",border:"none",borderRadius:"50%",width:32,height:32,fontSize:16,cursor:"pointer" }}>
            {editing ? "←" : "✕"}
          </button>
        </div>

        {/* LIST VIEW */}
        {!editing && (
          <>
            {list.length === 0 && (
              <div style={{ textAlign:"center",padding:"32px 0",color:"#ccc" }}>
                <div style={{ fontSize:40,marginBottom:10 }}>📭</div>
                <div style={{ fontWeight:700,fontSize:14,color:"#bbb" }}>No addresses saved yet</div>
              </div>
            )}

            {list.map((addr, i) => (
              <div key={addr.id} style={{ background:addr.isDefault?"#f0fff8":"#f9f9f9", border:`2px solid ${addr.isDefault?"#00b894":"transparent"}`, borderRadius:18, padding:"16px", marginBottom:12 }}>
                <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:8 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                    <span style={{ fontSize:18 }}>{addr.label==="Home"?"🏠":addr.label==="Work"?"🏢":addr.label==="Storage"?"📦":"📍"}</span>
                    <div>
                      <div style={{ fontWeight:800,fontSize:14,color:"#2C3E50",display:"flex",alignItems:"center",gap:6 }}>
                        {addr.label}
                        {addr.isDefault && <span style={{ fontSize:9,background:"#00b894",color:"#fff",borderRadius:5,padding:"2px 7px",fontWeight:700 }}>DEFAULT</span>}
                      </div>
                      <div style={{ fontSize:12,color:"#555",marginTop:3 }}>{addr.name}</div>
                    </div>
                  </div>
                  <div style={{ display:"flex",gap:6 }}>
                    <button onClick={()=>openEdit(addr)} style={{ background:"#E4EBF2",border:"none",borderRadius:8,padding:"5px 10px",fontSize:11,fontWeight:700,color:"#555",cursor:"pointer" }}>Edit</button>
                    <button onClick={()=>deleteAddr(addr.id)} style={{ background:"#fff0f0",border:"none",borderRadius:8,padding:"5px 10px",fontSize:11,fontWeight:700,color:"#ff6b6b",cursor:"pointer" }}>Del</button>
                  </div>
                </div>
                <div style={{ fontSize:12,color:"#888",lineHeight:1.6,paddingLeft:26 }}>
                  {addr.street}<br/>{addr.city}, {addr.state} {addr.zip}
                </div>
                {!addr.isDefault && (
                  <button onClick={()=>setDefault(addr.id)} style={{ marginTop:10,background:"transparent",border:"1.5px solid #00b894",borderRadius:10,padding:"6px 14px",fontSize:11,fontWeight:700,color:"#00b894",cursor:"pointer" }}>
                    Set as Default
                  </button>
                )}
              </div>
            ))}

            {list.length < 2 && (
              <button onClick={openNew} style={{ width:"100%",background:"#f9f9f9",border:"1.5px dashed #ddd",borderRadius:16,padding:"14px",fontSize:13,fontWeight:700,color:"#aaa",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginBottom:16 }}>
                <span style={{ fontSize:20 }}>➕</span> Add Address {list.length > 0 ? "(2 max)" : ""}
              </button>
            )}

            <Btn onClick={()=>{ onSave(list); onClose(); }} style={{ background:"#2C3E50",color:"#fff",width:"100%" }}>
              Save Addresses
            </Btn>
          </>
        )}

        {/* FORM VIEW */}
        {editing && (
          <>
            {/* Label picker */}
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11,fontWeight:700,color:"#aaa",marginBottom:8,letterSpacing:0.8 }}>ADDRESS LABEL</div>
              <div style={{ display:"flex",gap:8 }}>
                {LABELS.map(l => (
                  <button key={l} onClick={()=>setF("label",l)} style={{ flex:1,background:form.label===l?"#2C3E50":"#EEF2F7",border:"none",borderRadius:10,padding:"8px 4px",fontSize:11,fontWeight:700,color:form.label===l?"#fff":"#888",cursor:"pointer",transition:"all 0.15s" }}>
                    {l==="Home"?"🏠":l==="Work"?"🏢":l==="Storage"?"📦":"📍"} {l}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display:"flex",flexDirection:"column",gap:10,marginBottom:20 }}>
              <input value={form.name} onChange={e=>setF("name",e.target.value)} placeholder="Full name *" style={IS} />
              <input value={form.street} onChange={e=>setF("street",e.target.value)} placeholder="Street address *" style={IS} />
              <div style={{ display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:8 }}>
                <input value={form.city} onChange={e=>setF("city",e.target.value)} placeholder="City *" style={IS} />
                <input value={form.state} onChange={e=>setF("state",e.target.value)} placeholder="State" maxLength={2} style={{...IS,textTransform:"uppercase"}} />
                <input value={form.zip} onChange={e=>setF("zip",e.target.value)} placeholder="ZIP *" maxLength={5} style={IS} />
              </div>
            </div>

            <div style={{ display:"flex",gap:8 }}>
              <button onClick={()=>setEditing(null)} style={{ flex:1,background:"#EEF2F7",border:"none",borderRadius:12,padding:"12px",fontWeight:700,fontSize:13,color:"#555",cursor:"pointer" }}>Cancel</button>
              <Btn onClick={saveForm} style={{ flex:2,background:"#2C3E50",color:"#fff" }}>
                {editing==="new" ? "Add Address" : "Save Changes"}
              </Btn>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── PACKAGING GUIDE MODAL ────────────────────────────────────────────────────
function PackagingGuideModal({ figureValue, onConfirm, onClose }) {
  const hasInsurance = figureValue >= 100;
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:700,display:"flex",alignItems:"flex-end",justifyContent:"center" }}>
      <div style={{ background:"#fff",borderRadius:"28px 28px 0 0",padding:"24px 20px 44px",width:"100%",maxWidth:430,maxHeight:"85vh",overflowY:"auto" }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}>
          <div>
            <div style={{ fontWeight:800,fontSize:18,color:"#2C3E50" }}>📦 Packaging Guidelines</div>
            <div style={{ fontSize:11,color:"#aaa",marginTop:2 }}>Pack it right — protect your buyer and your rating</div>
          </div>
          <button onClick={onClose} style={{ background:"#E4EBF2",border:"none",borderRadius:"50%",width:32,height:32,fontSize:16,cursor:"pointer" }}>✕</button>
        </div>

        {/* Insurance notice */}
        {hasInsurance && (
          <div style={{ background:"#f0fff8",border:"1.5px solid #00b89433",borderRadius:14,padding:"12px 14px",marginBottom:16,display:"flex",gap:10 }}>
            <span style={{ fontSize:20 }}>🛡️</span>
            <div>
              <div style={{ fontWeight:800,fontSize:13,color:"#00b894" }}>USPS Insurance Included</div>
              <div style={{ fontSize:11,color:"#555",marginTop:3,lineHeight:1.5 }}>
                This item is valued at <strong>${figureValue}</strong> — USPS insurance is automatically added to your label at no extra cost. If the item is damaged in transit, the buyer can file a damage dispute and you can claim through USPS.
              </div>
            </div>
          </div>
        )}

        {/* Tips */}
        <div style={{ display:"flex",flexDirection:"column",gap:10,marginBottom:20 }}>
          {PACKAGING_TIPS.map((tip,i) => (
            <div key={i} style={{ display:"flex",gap:12,alignItems:"flex-start",background:"#f9f9f9",borderRadius:14,padding:"12px 14px" }}>
              <span style={{ fontSize:22,flexShrink:0 }}>{tip.icon}</span>
              <div style={{ fontSize:12,color:"#555",lineHeight:1.5 }}>{tip.tip}</div>
            </div>
          ))}
        </div>

        {/* USPS claim info */}
        <div style={{ background:"#EAF1FA",border:"1.5px solid #3A7BD533",borderRadius:14,padding:"12px 14px",marginBottom:20 }}>
          <div style={{ fontWeight:700,fontSize:12,color:"#3A7BD5",marginBottom:6 }}>🏛️ If your shipment is damaged</div>
          <div style={{ fontSize:11,color:"#555",lineHeight:1.6 }}>
            The buyer will file a damage dispute in the app. Escrow stays frozen. You can then file a USPS insurance claim at <strong>usps.com/help/claims.htm</strong> with photos of the damaged packaging. Claims typically resolve in 5–10 business days.
          </div>
        </div>

        <Btn onClick={onConfirm} style={{ background:"#2C3E50",color:"#fff",width:"100%" }}>
          I've Read This — Generate Label →
        </Btn>
      </div>
    </div>
  );
}

// ─── DISPUTE MODAL ────────────────────────────────────────────────────────────
const DISPUTE_REASONS = [
  { id:"not_as_described", label:"Not as described",    icon:"🔍", detail:"The figure looks different from the listing photos or description." },
  { id:"not_received",     label:"Never arrived",       icon:"📭", detail:"The package was not delivered or tracking shows no movement." },
  { id:"damaged",          label:"Arrived damaged",     icon:"💔", detail:"The figure or packaging was damaged during shipping transit.", uspsInsurance:true },
  { id:"wrong_item",       label:"Wrong item sent",     icon:"❓", detail:"I received a completely different figure than what I ordered." },
  { id:"other",            label:"Other issue",         icon:"⚠️", detail:"Something else went wrong with this transaction." },
];

const PACKAGING_TIPS = [
  { icon:"📦", tip:"Double-box fragile or high-value figures — place inner box inside a larger outer box with 2\" of padding between them." },
  { icon:"🫧", tip:"Wrap the figure in at least 2 layers of bubble wrap. For carded figures, use additional cardboard backing." },
  { icon:"🚫", tip:"Never use newspaper — it shifts during transit and provides almost no protection." },
  { icon:"📋", tip:"Include a packing slip inside with your username, the buyer's username, and the order number." },
  { icon:"🏷️", tip:"Write FRAGILE on all sides of the outer box and use fragile tape on seams." },
  { icon:"💰", tip:"For items over $100 — USPS insurance is automatically added to your label to cover damage in transit." },
];

function DisputeModal({ txn, shipment, disputeKind = "purchase", onSubmit, onClose }) {
  const [step, setStep] = useState("reason");   // reason | detail | confirm | done
  const [reason, setReason] = useState(null);
  const [detail, setDetail] = useState("");
  const isTrade = disputeKind === "trade";
  const purchaseDeliveredMs = shipment?.deliveredAt
    ? Date.now() - new Date(shipment.deliveredAt).getTime()
    : 0;
  const withinPurchaseWindow =
    !shipment?.deliveredAt || purchaseDeliveredMs < 7 * 24 * 3600000;
  const tradeStartMs = txn?.date ? new Date(`${txn.date}T12:00:00`).getTime() : 0;
  const withinTradeWindow =
    !isTrade || !tradeStartMs || Date.now() - tradeStartMs < 30 * 24 * 3600000;
  const withinWindow = isTrade ? withinTradeWindow : withinPurchaseWindow;

  if (!withinWindow) return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:700,display:"flex",alignItems:"flex-end",justifyContent:"center" }}>
      <div style={{ background:"#fff",borderRadius:"28px 28px 0 0",padding:"28px 20px 40px",width:"100%",maxWidth:430,textAlign:"center" }}>
        <div style={{ fontSize:52,marginBottom:12 }}>⏰</div>
        <div style={{ fontWeight:800,fontSize:18,color:"#2C3E50",marginBottom:8 }}>Dispute Window Closed</div>
        <div style={{ fontSize:13,color:"#aaa",marginBottom:20 }}>
          {isTrade
            ? "Trade issues must be reported within 30 days of the trade date."
            : "Disputes must be filed within 7 days of delivery. Funds may have already been released to the seller."}
        </div>
        <Btn onClick={onClose} style={{ background:"#2C3E50",color:"#fff",width:"100%" }}>OK</Btn>
      </div>
    </div>
  );

  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:700,display:"flex",alignItems:"flex-end",justifyContent:"center" }}>
      <div style={{ background:"#fff",borderRadius:"28px 28px 0 0",padding:"24px 20px 40px",width:"100%",maxWidth:430,maxHeight:"85vh",overflowY:"auto" }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20 }}>
          <div>
            <div style={{ fontWeight:800,fontSize:18,color:"#2C3E50" }}>{isTrade ? "🤝 Report a trade issue" : "🚨 Report a Problem"}</div>
            <div style={{ fontSize:11,color:"#aaa",marginTop:2 }}>
              {isTrade ? `${txn.cardName}` : `${txn.cardName} · $${txn.amount}`}
            </div>
          </div>
          <button onClick={step==="reason"?onClose:()=>setStep("reason")} style={{ background:"#E4EBF2",border:"none",borderRadius:"50%",width:32,height:32,fontSize:16,cursor:"pointer" }}>{step==="reason"?"✕":"←"}</button>
        </div>

        {/* 7d window warning */}
        {shipment?.deliveredAt && !isTrade && (
          <div style={{ background:"#fff8e6",border:"1.5px solid #f9ca24",borderRadius:12,padding:"10px 14px",marginBottom:16,display:"flex",gap:8,alignItems:"center" }}>
            <span style={{ fontSize:16 }}>⏱️</span>
            <div style={{ fontSize:11,fontWeight:600,color:"#f0932b" }}>
              You have 7 days from delivery to file a dispute. Escrow will be frozen immediately.
            </div>
          </div>
        )}
        {isTrade && (
          <div style={{ background:"#EAF1FA",border:"1.5px solid #DCE6F0",borderRadius:12,padding:"10px 14px",marginBottom:16,display:"flex",gap:8,alignItems:"center" }}>
            <span style={{ fontSize:16 }}>🤝</span>
            <div style={{ fontSize:11,fontWeight:600,color:"#3A7BD5" }}>
              Trade disputes do not freeze a delivery escrow. Our team will review and may contact both traders.
            </div>
          </div>
        )}

        {/* STEP: REASON */}
        {step==="reason" && (
          <>
            <div style={{ fontWeight:700,fontSize:13,color:"#555",marginBottom:12 }}>What's the issue?</div>
            {DISPUTE_REASONS.map(r => (
              <div key={r.id} onClick={()=>setReason(r)} style={{ background:reason?.id===r.id?"#fff0f0":"#f9f9f9", border:`2px solid ${reason?.id===r.id?"#ff6b6b":"transparent"}`, borderRadius:16, padding:"14px 16px", marginBottom:10, cursor:"pointer", display:"flex", alignItems:"center", gap:12, transition:"all 0.15s" }}>
                <span style={{ fontSize:26 }}>{r.icon}</span>
                <div>
                  <div style={{ fontWeight:800,fontSize:14,color:"#2C3E50" }}>{r.label}</div>
                  <div style={{ fontSize:11,color:"#aaa",marginTop:2 }}>{r.detail}</div>
                </div>
                {reason?.id===r.id && <div style={{ marginLeft:"auto",width:20,height:20,borderRadius:"50%",background:"#ff6b6b",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"#fff",flexShrink:0 }}>✓</div>}
              </div>
            ))}
            <Btn onClick={()=>{ if(reason) setStep("detail"); }} style={{ background:reason?"#2C3E50":"#eee",color:reason?"#fff":"#aaa",width:"100%",marginTop:6,cursor:reason?"pointer":"default" }}>Continue →</Btn>
          </>
        )}

        {/* STEP: DETAIL */}
        {step==="detail" && (
          <>
            <div style={{ background:"#f9f9f9",borderRadius:14,padding:"12px 14px",marginBottom:16,display:"flex",alignItems:"center",gap:10 }}>
              <span style={{ fontSize:24 }}>{reason?.icon}</span>
              <div style={{ fontWeight:700,fontSize:13,color:"#2C3E50" }}>{reason?.label}</div>
            </div>

            {/* Extra guidance for damage claims */}
            {reason?.id === "damaged" && (
              <div style={{ background:"#fff8e6",border:"1.5px solid #f9ca24",borderRadius:14,padding:"12px 14px",marginBottom:14 }}>
                <div style={{ fontWeight:700,fontSize:12,color:"#f0932b",marginBottom:8 }}>📸 Photos required for damage claims</div>
                {["The damaged figure (all angles)","The outer box — show all sides","Inner packaging and cushioning","The shipping label clearly visible"].map((t,i)=>(
                  <div key={i} style={{ display:"flex",gap:6,marginBottom:4 }}>
                    <span style={{ color:"#f0932b",fontWeight:700,fontSize:11 }}>✓</span>
                    <span style={{ fontSize:11,color:"#555" }}>{t}</span>
                  </div>
                ))}
                <div style={{ marginTop:10,background:"rgba(255,255,255,0.7)",borderRadius:10,padding:"8px 12px" }}>
                  <div style={{ fontSize:11,fontWeight:700,color:"#3A7BD5" }}>🏛️ USPS Insurance Claim</div>
                  <div style={{ fontSize:11,color:"#555",marginTop:3,lineHeight:1.5 }}>File at <strong>usps.com/help/claims.htm</strong> — our admin will assist after reviewing your dispute.</div>
                </div>
              </div>
            )}

            <div style={{ fontWeight:700,fontSize:13,color:"#555",marginBottom:8 }}>Describe the issue</div>
            <textarea
              value={detail} onChange={e=>setDetail(e.target.value)}
              placeholder={reason?.id==="damaged" ? "Describe the damage — what broke, how was it packaged, what did the box look like when it arrived…" : "Please describe what happened in as much detail as possible. Include photos if available..."}
              rows={5}
              style={{ ...IS, resize:"vertical", lineHeight:1.5, marginBottom:16 }}
            />
            <div style={{ background:"#EAF1FA",borderRadius:12,padding:"10px 14px",marginBottom:20,fontSize:11,color:"#3A7BD5",fontWeight:600 }}>
              📸 {reason?.id==="damaged" ? "Upload photos when admin contacts you — keep originals safe." : "Once submitted, an admin will contact you to request photos. Keep photos of the figure and packaging ready."}
            </div>
            <Btn onClick={()=>{ if(detail.length>10) setStep("confirm"); }} style={{ background:detail.length>10?"#2C3E50":"#eee",color:detail.length>10?"#fff":"#aaa",width:"100%" }}>Review Dispute →</Btn>
          </>
        )}

        {/* STEP: CONFIRM */}
        {step==="confirm" && (
          <>
            <div style={{ background:"#fff0f0",border:"2px solid #ff6b6b",borderRadius:16,padding:"16px",marginBottom:16 }}>
              <div style={{ fontWeight:800,fontSize:14,color:"#ff6b6b",marginBottom:10 }}>⚠️ Before you submit</div>
              {[
                isTrade ? "Support will review your report and may message both parties" : "Escrow will be frozen — seller cannot receive funds until resolved",
                "Admin will review within 24 hours",
                "False disputes may affect your account rating",
                isTrade ? "Be ready to share photos or tracking if asked" : "You may be asked to return the item if a refund is granted",
              ].map((t,i) => (
                <div key={i} style={{ display:"flex",gap:8,marginBottom:6,alignItems:"flex-start" }}>
                  <span style={{ color:"#ff6b6b",fontSize:12,marginTop:1 }}>•</span>
                  <span style={{ fontSize:12,color:"#555" }}>{t}</span>
                </div>
              ))}
            </div>
            <div style={{ background:"#f9f9f9",borderRadius:14,padding:"12px 14px",marginBottom:20 }}>
              <div style={{ fontSize:11,fontWeight:700,color:"#aaa",marginBottom:6 }}>YOUR DISPUTE</div>
              <div style={{ fontWeight:700,fontSize:13,color:"#2C3E50",marginBottom:4 }}>{reason?.label}</div>
              <div style={{ fontSize:12,color:"#888",lineHeight:1.5 }}>{detail}</div>
            </div>
            <div style={{ display:"flex",gap:8 }}>
              <button onClick={()=>setStep("detail")} style={{ flex:1,background:"#EEF2F7",border:"none",borderRadius:12,padding:"12px",fontWeight:700,fontSize:13,color:"#555",cursor:"pointer" }}>← Back</button>
              <Btn onClick={()=>{ onSubmit({ txn, shipment, reason: reason.id, detail, disputeKind }); setStep("done"); }} style={{ flex:2,background:"linear-gradient(135deg,#ff6b6b,#ee5a24)",color:"#fff" }}>Submit Dispute 🚨</Btn>
            </div>
          </>
        )}

        {/* STEP: DONE */}
        {step==="done" && (
          <div style={{ textAlign:"center",padding:"20px 0" }}>
            <div style={{ fontSize:52,marginBottom:14 }}>{isTrade ? "🤝" : "🔒"}</div>
            <div style={{ fontWeight:800,fontSize:20,color:"#2C3E50",marginBottom:8 }}>{isTrade ? "Report received" : "Dispute Filed"}</div>
            <div style={{ fontSize:13,color:"#aaa",marginBottom:6 }}>{isTrade ? "Support will follow up if needed" : "Escrow is now frozen"}</div>
            <div style={{ background:"#f9f9f9",borderRadius:14,padding:"14px",marginBottom:24,textAlign:"left" }}>
              {[
                ["Status", "Under Review 🔍"],
                ["Response time", "Within 24 hours"],
                ["Your case", isTrade ? "Trade dispute logged" : "Logged & assigned"],
              ].map(([l,v])=>(
                <div key={l} style={{ display:"flex",justifyContent:"space-between",marginBottom:6 }}>
                  <span style={{ fontSize:12,color:"#aaa" }}>{l}</span>
                  <span style={{ fontSize:12,fontWeight:700,color:"#2C3E50" }}>{v}</span>
                </div>
              ))}
            </div>
            <Btn onClick={onClose} style={{ background:"#2C3E50",color:"#fff",width:"100%" }}>Done</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── RATING MODAL ─────────────────────────────────────────────────────────────
function RatingModal({ txn, otherUser, isBuyer, onSubmit, onClose }) {
  const [score, setScore] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);

  const QUICK = isBuyer
    ? ["Fast payment","Great communicator","Would trade again","Smooth transaction"]
    : ["Item as described","Well packaged","Fast shipper","Accurate photos"];

  if (done) return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:700,display:"flex",alignItems:"center",justifyContent:"center" }}>
      <div style={{ background:"#fff",borderRadius:28,padding:"40px 32px",maxWidth:360,width:"90%",textAlign:"center" }}>
        <div style={{ fontSize:52,marginBottom:14 }}>⭐</div>
        <div style={{ fontWeight:800,fontSize:20,color:"#2C3E50",marginBottom:8 }}>Rating Submitted!</div>
        <div style={{ fontSize:13,color:"#aaa",marginBottom:20 }}>{otherUser?.username}'s rating has been updated</div>
        <Btn onClick={onClose} style={{ background:"#2C3E50",color:"#fff",width:"100%" }}>Done</Btn>
      </div>
    </div>
  );

  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:700,display:"flex",alignItems:"flex-end",justifyContent:"center" }}>
      <div style={{ background:"#fff",borderRadius:"28px 28px 0 0",padding:"24px 20px 44px",width:"100%",maxWidth:430,maxHeight:"85vh",overflowY:"auto" }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20 }}>
          <div style={{ fontWeight:800,fontSize:18,color:"#2C3E50" }}>Rate this {isBuyer?"seller":"buyer"}</div>
          <button onClick={onClose} style={{ background:"#E4EBF2",border:"none",borderRadius:"50%",width:32,height:32,fontSize:16,cursor:"pointer" }}>✕</button>
        </div>

        {/* Other user */}
        <div style={{ display:"flex",alignItems:"center",gap:12,background:"#f9f9f9",borderRadius:16,padding:"14px",marginBottom:20 }}>
          <div style={{ width:48,height:48,borderRadius:"50%",background:"#E4EBF2",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26 }}>{otherUser?.avatar}</div>
          <div>
            <div style={{ fontWeight:800,fontSize:15,color:"#2C3E50" }}>{otherUser?.username}</div>
            <div style={{ fontSize:11,color:"#aaa",marginTop:2 }}>Transaction: {txn.cardName}</div>
            <div style={{ fontSize:11,color:"#aaa" }}>Current rating: ⭐ {otherUser?.rating}</div>
          </div>
        </div>

        {/* Star picker */}
        <div style={{ textAlign:"center",marginBottom:20 }}>
          <div style={{ fontSize:12,fontWeight:700,color:"#555",marginBottom:12 }}>How was your experience?</div>
          <div style={{ display:"flex",justifyContent:"center",gap:8 }}>
            {[1,2,3,4,5].map(s => (
              <span key={s}
                onMouseEnter={()=>setHovered(s)} onMouseLeave={()=>setHovered(0)}
                onClick={()=>setScore(s)}
                style={{ fontSize:40,cursor:"pointer",transition:"transform 0.15s",transform:(hovered||score)>=s?"scale(1.2)":"scale(1)",filter:(hovered||score)>=s?"none":"grayscale(1)" }}
              >⭐</span>
            ))}
          </div>
          {score > 0 && (
            <div style={{ marginTop:8,fontWeight:800,fontSize:14,color: score>=4?"#00b894":score===3?"#f0932b":"#ff6b6b" }}>
              {["","😞 Poor","😕 Below average","😐 OK","😊 Good","🤩 Excellent!"][score]}
            </div>
          )}
        </div>

        {/* Quick tags */}
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:12,fontWeight:700,color:"#555",marginBottom:8 }}>Quick tags (optional)</div>
          <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
            {QUICK.map(q => {
              const active = comment.includes(q);
              return (
                <button key={q} onClick={()=>setComment(c => active ? c.replace(q+". ","").replace(q,"") : c+(c?". ":"")+q)}
                  style={{ background:active?"#2C3E50":"#EEF2F7",border:"none",borderRadius:20,padding:"6px 12px",fontSize:11,fontWeight:700,color:active?"#fff":"#888",cursor:"pointer",transition:"all 0.15s" }}>
                  {active?"✓ ":""}{q}
                </button>
              );
            })}
          </div>
        </div>

        {/* Comment */}
        <textarea
          value={comment} onChange={e=>setComment(e.target.value)}
          placeholder={`Tell others about your experience with ${otherUser?.username}…`}
          rows={3}
          style={{ ...IS, resize:"none", lineHeight:1.5, marginBottom:20 }}
        />

        <Btn onClick={()=>{ if(score>0){ onSubmit({ txn, toUserId:otherUser?.id, score, comment, type:isBuyer?"buyer_to_seller":"seller_to_buyer" }); setDone(true); } }}
          style={{ background:score>0?"linear-gradient(135deg,#f9ca24,#f0932b)":"#eee",color:score>0?"#fff":"#aaa",width:"100%",cursor:score>0?"pointer":"default" }}>
          Submit Rating ⭐
        </Btn>
      </div>
    </div>
  );
}

// ─── CONTENT FILTER ───────────────────────────────────────────────────────────
const PII_PATTERNS = [
  { pattern: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/,                              label: "phone number"       },
  { pattern: /\b\d{10,11}\b/,                                                    label: "phone number"       },
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/,                    label: "email address"      },
  { pattern: /\b(https?:\/\/|www\.)\S+/i,                                        label: "external link"      },
  { pattern: /\b\S+\.(com|net|org|io|co)\b/i,                                   label: "external link"      },
  { pattern: /@[a-zA-Z0-9_.]{2,}/,                                               label: "social media handle"},
  { pattern: /\b(venmo|cashapp|zelle|cash app)\b/i,                             label: "payment app"        },
  { pattern: /\b(snapchat|instagram|insta|telegram|whatsapp|signal|discord)\b/i,label: "external platform"  },
  { pattern: /\b(text me|call me|dm me|my number|reach me)\b/i,                 label: "off-platform request"},
];

function scanMessage(text) {
  for (const { pattern, label } of PII_PATTERNS) {
    if (pattern.test(text)) return { blocked: true, label };
  }
  return { blocked: false };
}

// ─── MESSAGING SCREEN ─────────────────────────────────────────────────────────
function MessagingScreen({ threads, activeThreadId, setActiveThread, currentUserId, getUser, onSend, onFlag }) {
  const [input, setInput] = useState("");
  const [blocked, setBlocked] = useState(null); // { label } when blocked
  const [showWarning, setShowWarning] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const thread = threads.find(t => t.id === activeThreadId);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [thread?.messages?.length, activeThreadId]);

  useEffect(() => {
    const onKeyboard = () => {
      setTimeout(scrollToBottom, 50);
      setTimeout(scrollToBottom, 300);
    };
    window.addEventListener("inhand:keyboard-show", onKeyboard);
    return () => window.removeEventListener("inhand:keyboard-show", onKeyboard);
  }, [activeThreadId]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    const scan = scanMessage(text);
    if (scan.blocked) {
      setBlocked(scan);
      onFlag && onFlag(thread?.id, text, scan.label);
      return;
    }
    onSend(thread.id, text);
    setInput("");
    setBlocked(null);
  };

  const handleInputChange = (val) => {
    setInput(val);
    if (blocked) setBlocked(null); // clear error on edit
  };

  // ── THREAD LIST ──
  if (!activeThreadId) return (
    <div className="inhand-messages">
      <div className="inhand-messages-list">
      <div style={{ fontWeight:800, fontSize:18, color:"#2C3E50", marginBottom:4 }}>Messages 💬</div>
      <div style={{ fontSize:12, color:"#bbb", marginBottom:16 }}>Your trade conversations</div>

      {threads.length === 0 ? (
        <div style={{ textAlign:"center", padding:"40px 0" }}>
          <div style={{ fontSize:52, marginBottom:14 }}>💬</div>
          <div style={{ fontWeight:700, fontSize:16, color:"#bbb" }}>No messages yet</div>
          <div style={{ fontSize:12, color:"#ccc", marginTop:6 }}>Start a conversation from any listing</div>
        </div>
      ) : threads.map(th => {
        const otherId = th.participants.find(p => p !== currentUserId);
        const other = getUser(otherId);
        const lastMsg = th.messages[th.messages.length - 1];
        const isUnread = lastMsg && lastMsg.from !== currentUserId;
        return (
          <div key={th.id} onClick={() => setActiveThread(th.id)}
            style={{ background:"#fff", borderRadius:18, padding:"14px 16px", marginBottom:10, boxShadow:"0 2px 10px rgba(0,0,0,0.05)", border:`1px solid ${isUnread?"#4A90D9":"#E4EBF2"}`, cursor:"pointer", display:"flex", gap:12, alignItems:"center" }}>
            <div style={{ position:"relative", flexShrink:0 }}>
              <div style={{ width:48, height:48, borderRadius:"50%", background:"#E4EBF2", display:"flex", alignItems:"center", justifyContent:"center", fontSize:26 }}>{other?.avatar}</div>
              {isUnread && <div style={{ position:"absolute", top:-2, right:-2, width:12, height:12, background:"#4A90D9", borderRadius:"50%", border:"2px solid #fff" }} />}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3, gap:8, flexWrap:"wrap" }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                  <div style={{ fontWeight:800, fontSize:14, color:"#2C3E50" }}>{other?.username}</div>
                  {other?.verified && <VerifiedInHandBadge compact />}
                </div>
                <div style={{ fontSize:10, color:"#ccc" }}>{lastMsg?.ts?.slice(5,16) || ""}</div>
              </div>
              {th.cardName && (
                <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:4 }}>
                  <span style={{ fontSize:14 }}>{th.cardImage}</span>
                  <span style={{ fontSize:10, color:"#aaa", fontWeight:600 }}>{th.cardName}</span>
                </div>
              )}
              <div style={{ fontSize:12, color:isUnread?"#2C3E50":"#aaa", fontWeight:isUnread?700:400, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                {lastMsg ? (lastMsg.from===currentUserId?"You: ":"")+lastMsg.text : "Start the conversation"}
              </div>
              {th.flagCount > 0 && <span style={{ fontSize:9, background:"#fff0f0", color:"#ff6b6b", borderRadius:5, padding:"1px 6px", fontWeight:700 }}>⚠️ {th.flagCount} flagged</span>}
            </div>
            <div style={{ fontSize:18, color:"#ddd", flexShrink:0 }}>›</div>
          </div>
        );
      })}
      </div>
    </div>
  );

  // ── CHAT VIEW ──
  const otherId = thread?.participants.find(p => p !== currentUserId);
  const other = getUser(otherId);

  return (
    <div className="inhand-messages inhand-messages-chat inhand-messages-chat--active">

      {/* Chat header */}
      <div className="inhand-messages-chat-header">
        <button onClick={() => { setActiveThread(null); setBlocked(null); }} style={{ background:"#E4EBF2", border:"none", borderRadius:10, padding:"6px 10px", fontWeight:700, fontSize:13, color:"#555", cursor:"pointer" }}>←</button>
        <div style={{ width:38, height:38, borderRadius:"50%", background:"#E4EBF2", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>{other?.avatar}</div>
        <div style={{ flex:1 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
            <div style={{ fontWeight:800, fontSize:14, color:"#2C3E50" }}>{other?.username}</div>
            {other?.verified && <VerifiedInHandBadge compact />}
          </div>
          <div style={{ fontSize:10, color:"#aaa" }}>⭐ {other?.rating} · {other?.tradesCompleted} trades</div>
        </div>
        {thread?.cardImage && (
          <div style={{ background:"#EEF2F7", borderRadius:10, padding:"5px 10px", display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ fontSize:18 }}>{thread.cardImage}</span>
            <span style={{ fontSize:10, fontWeight:700, color:"#555", maxWidth:80, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{thread.cardName}</span>
          </div>
        )}
      </div>

      {/* Safety banner */}
      {!showWarning ? (
        <div className="inhand-messages-banner" style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer" }} onClick={()=>setShowWarning(true)}>
          <span style={{ fontSize:14 }}>🛡️</span>
          <span style={{ fontSize:11, color:"#3A7BD5", fontWeight:600, flex:1 }}>Keep conversations on In Hand for your protection</span>
          <span style={{ fontSize:11, color:"#90B8E8", fontWeight:700 }}>Why? ›</span>
        </div>
      ) : (
        <div className="inhand-messages-banner">
          <div style={{ fontWeight:800, fontSize:13, color:"#3A7BD5", marginBottom:6 }}>🛡️ Why we keep chats on platform</div>
          <div style={{ fontSize:11, color:"#555", lineHeight:1.6, marginBottom:8 }}>
            Sharing phone numbers, emails, or social handles bypasses our escrow protection. If a deal goes wrong off-platform, we can't help you recover funds or resolve disputes. Sharing payment apps like Venmo or CashApp also voids buyer protection.
          </div>
          <div style={{ fontSize:11, color:"#888", marginBottom:8 }}>
            <strong>Blocked automatically:</strong> phone numbers · emails · social handles · external links · payment apps
          </div>
          <button onClick={()=>setShowWarning(false)} style={{ fontSize:11, fontWeight:700, color:"#3A7BD5", background:"none", border:"none", cursor:"pointer", padding:0 }}>Got it ✓</button>
        </div>
      )}

      {/* Messages */}
      <div className="inhand-messages-scroll">
        {thread?.messages.length === 0 && (
          <div style={{ textAlign:"center", padding:"24px 0", color:"#ccc" }}>
            <div style={{ fontSize:36, marginBottom:8 }}>👋</div>
            <div style={{ fontSize:13, fontWeight:600 }}>Say hi to {other?.username}!</div>
            <div style={{ fontSize:11, color:"#ddd", marginTop:4 }}>Ask about accessories, condition, yellowing — anything!</div>
          </div>
        )}
        {thread?.messages.map((msg, i) => {
          const isMe = msg.from === currentUserId;
          const showAvatar = !isMe && (i===0 || thread.messages[i-1]?.from !== msg.from);
          const isSystemMsg = msg.type === "system";
          if (isSystemMsg) return (
            <div key={msg.id} style={{ textAlign:"center", margin:"4px 0" }}>
              <span style={{ fontSize:10, background:"#E4EBF2", color:"#aaa", borderRadius:20, padding:"3px 12px", fontWeight:600 }}>{msg.text}</span>
            </div>
          );
          return (
            <div key={msg.id} style={{ display:"flex", gap:8, alignItems:"flex-end", flexDirection:isMe?"row-reverse":"row" }}>
              {!isMe && (
                <div style={{ width:28, height:28, borderRadius:"50%", background:"#E4EBF2", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0, opacity:showAvatar?1:0 }}>{other?.avatar}</div>
              )}
              <div style={{ maxWidth:"72%" }}>
                <div style={{ background:isMe?"#2C3E50":"#EEF2F7", color:isMe?"#fff":"#2C3E50", borderRadius:isMe?"18px 18px 4px 18px":"18px 18px 18px 4px", padding:"10px 14px", fontSize:13, lineHeight:1.4, fontWeight:500, boxShadow:isMe?"0 2px 8px rgba(26,26,46,0.2)":"0 1px 4px rgba(0,0,0,0.06)" }}>
                  {msg.text}
                </div>
                <div style={{ fontSize:9, color:"#ccc", marginTop:3, textAlign:isMe?"right":"left" }}>{msg.ts}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Blocked message warning */}
      {blocked && (
        <div className="inhand-messages-blocked" style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
          <span style={{ fontSize:18, flexShrink:0 }}>🚫</span>
          <div>
            <div style={{ fontWeight:800, fontSize:12, color:"#ff6b6b" }}>Message blocked — {blocked.label} detected</div>
            <div style={{ fontSize:11, color:"#888", marginTop:2 }}>Sharing personal contact info violates our safety policy and removes your buyer protection. Please keep all communication on In Hand.</div>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="inhand-messages-composer">
        <input
          ref={inputRef}
          value={input}
          onChange={e => handleInputChange(e.target.value)}
          onFocus={() => {
            requestAnimationFrame(() => {
              inputRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
              scrollToBottom();
            });
            setTimeout(scrollToBottom, 150);
            setTimeout(scrollToBottom, 400);
          }}
          onKeyDown={e => { if (e.key==="Enter") handleSend(); }}
          placeholder="Message…"
          data-blocked={blocked ? "true" : "false"}
        />
        <button
          type="button"
          onClick={handleSend}
          className="inhand-messages-send"
          data-active={input.trim() && !blocked ? "true" : "false"}
          aria-label="Send message"
        >➤</button>
      </div>
    </div>
  );
}

// ─── EMAIL TEMPLATES ──────────────────────────────────────────────────────────
const EMAIL_TEMPLATES = [
  {
    id: "trade_confirmed",
    trigger: "Trade Confirmed",
    icon: "🤝",
    to: "Both traders",
    subject: "Your In Hand trade is confirmed! 🤝",
    color: "#00b894",
    sections: [
      { type:"hero", text:"Trade Confirmed!", sub:"Your figures are on their way." },
      { type:"figures", label:"YOU GIVE", figA:true, label2:"YOU RECEIVE", figB:true },
      { type:"row", items:[["Trader","RetroPlastic_Joe"],["Date","Nov 12, 2024"],["Trade ID","#TRD-8821"]] },
      { type:"receipt", rows:[["Trade fee (per party)","$2.00"],["Charged to","Each trader's wallet"]] },
      { type:"escrow", text:"Both figures must be shipped within 3 days. USPS Ground Advantage labels are available in the app." },
      { type:"cta", text:"View Trade in App", color:"#00b894" },
      { type:"footer" },
    ]
  },
  {
    id: "purchase_buyer",
    trigger: "Purchase — Buyer",
    icon: "🛒",
    to: "Buyer",
    subject: "Your purchase is confirmed — payment in escrow",
    color: "#3A7BD5",
    sections: [
      { type:"hero", text:"Payment Received!", sub:"Your funds are safely held in escrow." },
      { type:"receipt", rows:[["Item","Optimus Prime G1 Boxed"],["Condition","Brand New 📦"],["Item price","$580.00"],["Platform fee (5%)","$29.00"],["USPS Ground shipping","$19.95"],["Total charged","$628.95"]] },
      { type:"escrow", text:"Your payment is held securely until USPS tracking confirms delivery. Funds auto-release to the seller 7 days after delivery." },
      { type:"cta", text:"Track Your Order", color:"#3A7BD5" },
      { type:"footer" },
    ]
  },
  {
    id: "purchase_seller",
    trigger: "Purchase — Seller",
    icon: "💸",
    to: "Seller",
    subject: "You made a sale! Ship within 3 days 📦",
    color: "#f0932b",
    sections: [
      { type:"hero", text:"Item Sold!", sub:"Generate your label and ship within 3 days." },
      { type:"receipt", rows:[["Item","Optimus Prime G1 Boxed"],["Sale price","$580.00"],["Platform fee (5%)","- $29.00"],["You receive","$551.00"]] },
      { type:"info", text:"⏰ You must ship within 3 days or the order may be cancelled. Generate your prepaid USPS label in the app." },
      { type:"cta", text:"Generate Shipping Label", color:"#f0932b" },
      { type:"footer" },
    ]
  },
  {
    id: "shipped",
    trigger: "Item Shipped",
    icon: "📦",
    to: "Buyer",
    subject: "Your figure has shipped! 📦 Track it here",
    color: "#3A7BD5",
    sections: [
      { type:"hero", text:"On Its Way!", sub:"Your figure has been shipped via USPS Ground." },
      { type:"tracking", number:"9400111899223397607175", status:"Accepted at USPS facility", location:"Brooklyn, NY", date:"Nov 12, 2024" },
      { type:"row", items:[["Seller","RetroPlastic_Joe"],["Service","USPS Ground Advantage"],["Est. delivery","Nov 16–18, 2024"]] },
      { type:"escrow", text:"Remember: you have 7 days after delivery to report any problems before funds are released to the seller." },
      { type:"cta", text:"Track Package", color:"#3A7BD5" },
      { type:"footer" },
    ]
  },
  {
    id: "delivered",
    trigger: "Delivered",
    icon: "📬",
    to: "Buyer",
    subject: "Your figure was delivered! Funds release in 7d",
    color: "#f9ca24",
    sections: [
      { type:"hero", text:"Delivered!", sub:"Your package arrived — check it out!" },
      { type:"countdown", hours:48 },
      { type:"row", items:[["Delivered","Nov 16, 2024 at 2:34 PM"],["Location","Front Door"],["Signed by","Left at door"]] },
      { type:"info", text:"🔍 If there's a problem with your order — wrong item, damage, or not as described — open a dispute in the app before the 7-day window closes." },
      { type:"cta", text:"Report a Problem", color:"#ff6b6b" },
      { type:"footer" },
    ]
  },
  {
    id: "funds_released",
    trigger: "Funds Released",
    icon: "💰",
    to: "Seller",
    subject: "You've been paid! $551.00 in your wallet 💰",
    color: "#00b894",
    sections: [
      { type:"hero", text:"You've Been Paid!", sub:"Funds have been released to your In Hand wallet." },
      { type:"receipt", rows:[["Sale price","$580.00"],["Platform fee","- $29.00"],["Amount received","$551.00"],["Wallet balance","$1,809.70"]] },
      { type:"info", text:"💰 Your earnings are in your In Hand wallet. Withdraw to your bank or payment method anytime from the Wallet tab." },
      { type:"cta", text:"View Wallet", color:"#00b894" },
      { type:"footer" },
    ]
  },
  {
    id: "rate_trade",
    trigger: "Rate Your Trade",
    icon: "⭐",
    to: "Both parties",
    subject: "How was your trade with RetroPlastic_Joe? ⭐",
    color: "#f9ca24",
    sections: [
      { type:"hero", text:"Rate Your Experience", sub:"Help the community by leaving a rating." },
      { type:"stars" },
      { type:"info", text:"Your rating helps other collectors know who to trust. It only takes 10 seconds." },
      { type:"cta", text:"Leave a Rating", color:"#f9ca24" },
      { type:"footer" },
    ]
  },
  {
    id: "dispute_opened",
    trigger: "Dispute Opened",
    icon: "🚨",
    to: "Both parties",
    subject: "A dispute has been filed — escrow frozen 🔒",
    color: "#ff6b6b",
    sections: [
      { type:"hero", text:"Dispute Filed", sub:"Escrow is frozen while we review.", alert:true },
      { type:"receipt", rows:[["Item","Optimus Prime G1 Boxed"],["Reason","Not as described"],["Filed by","BotCollector88"],["Status","Under review"]] },
      { type:"info", text:"🔒 Funds are frozen and cannot be released until this dispute is resolved. Our team will review within 24 hours and may ask for photos." },
      { type:"cta", text:"View Dispute", color:"#ff6b6b" },
      { type:"footer" },
    ]
  },
];

function EmailTemplatePreview({ template }) {
  const accentColor = template.color;

  const renderSection = (s, i) => {
    switch(s.type) {
      case "hero": return (
        <div key={i} style={{ background: s.alert ? "#fff0f0" : `${accentColor}12`, borderRadius:12, padding:"24px 20px", textAlign:"center", marginBottom:16, border: s.alert ? `2px solid ${accentColor}` : "none" }}>
          <div style={{ fontSize:40, marginBottom:10 }}>{template.icon}</div>
          <div style={{ fontWeight:900, fontSize:22, color:"#2C3E50", marginBottom:6 }}>{s.text}</div>
          <div style={{ fontSize:13, color:"#888" }}>{s.sub}</div>
        </div>
      );
      case "receipt": return (
        <div key={i} style={{ background:"#f9f9f9", borderRadius:12, padding:"14px 16px", marginBottom:16 }}>
          {s.rows.map(([label,val],j)=>(
            <div key={j} style={{ display:"flex", justifyContent:"space-between", paddingBottom:j<s.rows.length-1?10:0, marginBottom:j<s.rows.length-1?10:0, borderBottom:j<s.rows.length-1?"1px solid #ebebeb":"none" }}>
              <span style={{ fontSize:12, color:"#888" }}>{label}</span>
              <span style={{ fontSize:12, fontWeight:j===s.rows.length-1?900:700, color:j===s.rows.length-1?accentColor:"#2C3E50" }}>{val}</span>
            </div>
          ))}
        </div>
      );
      case "row": return (
        <div key={i} style={{ display:"grid", gridTemplateColumns:`repeat(${s.items.length},1fr)`, gap:8, marginBottom:16 }}>
          {s.items.map(([label,val],j)=>(
            <div key={j} style={{ background:"#f9f9f9", borderRadius:10, padding:"10px 12px", textAlign:"center" }}>
              <div style={{ fontSize:10, color:"#aaa", fontWeight:700, marginBottom:4 }}>{label.toUpperCase()}</div>
              <div style={{ fontSize:12, fontWeight:700, color:"#2C3E50", lineHeight:1.3 }}>{val}</div>
            </div>
          ))}
        </div>
      );
      case "figures": return (
        <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr auto 1fr", gap:10, alignItems:"center", marginBottom:16 }}>
          <div style={{ background:"#f0fff8", borderRadius:12, padding:"12px", textAlign:"center" }}>
            <div style={{ fontSize:10, fontWeight:700, color:"#aaa", marginBottom:6 }}>{s.label}</div>
            <div style={{ fontSize:32 }}>🐍</div>
            <div style={{ fontSize:11, fontWeight:700, color:"#2C3E50", marginTop:4 }}>Cobra Commander</div>
            <div style={{ fontSize:11, color:"#00b894", fontWeight:800 }}>$165</div>
          </div>
          <div style={{ fontSize:22, color:"#ddd", textAlign:"center" }}>⇄</div>
          <div style={{ background:"#EAF1FA", borderRadius:12, padding:"12px", textAlign:"center" }}>
            <div style={{ fontSize:10, fontWeight:700, color:"#aaa", marginBottom:6 }}>{s.label2}</div>
            <div style={{ fontSize:32 }}>🥷</div>
            <div style={{ fontSize:11, fontWeight:700, color:"#2C3E50", marginTop:4 }}>Snake Eyes</div>
            <div style={{ fontSize:11, color:"#3A7BD5", fontWeight:800 }}>$220</div>
          </div>
        </div>
      );
      case "tracking": return (
        <div key={i} style={{ background:"#f9f9f9", borderRadius:12, padding:"14px 16px", marginBottom:16 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#aaa", marginBottom:8, letterSpacing:0.8 }}>TRACKING NUMBER</div>
          <div style={{ fontFamily:"monospace", fontSize:13, fontWeight:700, color:"#2C3E50", marginBottom:12, wordBreak:"break-all" }}>{s.number}</div>
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <div style={{ width:10, height:10, borderRadius:"50%", background:accentColor, flexShrink:0 }} />
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:"#2C3E50" }}>{s.status}</div>
              <div style={{ fontSize:11, color:"#aaa" }}>{s.location} · {s.date}</div>
            </div>
          </div>
        </div>
      );
      case "countdown": return (
        <div key={i} style={{ background:"#fff8e6", border:"2px solid #f9ca24", borderRadius:12, padding:"16px", textAlign:"center", marginBottom:16 }}>
          <div style={{ fontSize:28, marginBottom:6 }}>⏱️</div>
          <div style={{ fontWeight:800, fontSize:16, color:"#2C3E50", marginBottom:4 }}>Funds auto-release in {s.hours} hours</div>
          <div style={{ fontSize:12, color:"#888" }}>Report any problems before the window closes</div>
        </div>
      );
      case "escrow": return (
        <div key={i} style={{ background:"#EAF1FA", borderRadius:12, padding:"12px 14px", marginBottom:16, display:"flex", gap:8 }}>
          <span style={{ fontSize:16 }}>🔒</span>
          <div style={{ fontSize:12, color:"#555", lineHeight:1.5 }}>{s.text}</div>
        </div>
      );
      case "info": return (
        <div key={i} style={{ background:"#f9f9f9", borderRadius:12, padding:"12px 14px", marginBottom:16 }}>
          <div style={{ fontSize:12, color:"#555", lineHeight:1.6 }}>{s.text}</div>
        </div>
      );
      case "stars": return (
        <div key={i} style={{ textAlign:"center", padding:"16px 0", marginBottom:16 }}>
          <div style={{ display:"flex", justifyContent:"center", gap:8, marginBottom:12 }}>
            {[1,2,3,4,5].map(s=><span key={s} style={{ fontSize:36 }}>⭐</span>)}
          </div>
          <div style={{ fontSize:12, color:"#aaa" }}>Tap to rate your experience</div>
        </div>
      );
      case "cta": return (
        <div key={i} style={{ textAlign:"center", marginBottom:16 }}>
          <div style={{ background:s.color, borderRadius:14, padding:"14px 28px", display:"inline-block", color:"#fff", fontWeight:800, fontSize:14, cursor:"pointer", boxShadow:`0 4px 14px ${s.color}44` }}>{s.text}</div>
        </div>
      );
      case "footer": return (
        <div key={i} style={{ borderTop:"1px solid #E4EBF2", paddingTop:16, textAlign:"center" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginBottom:8 }}>
            <div style={{ width:28, height:28, borderRadius:8, overflow:"hidden", background:"#1a1d21" }}>
              <img src={LOGO_IMG} alt="In Hand" style={{ width:"100%", height:"100%", objectFit:"contain" }} />
            </div>
            <span style={{ fontWeight:900, fontSize:15, color:"#2C3E50" }}>In <span style={{ color:"#3A7BD5" }}>Hand</span></span>
          </div>
          <div style={{ fontSize:10, color:"#ccc", lineHeight:1.6 }}>
            Action Figure Exchange · noreply@inhand.app<br/>
            <span style={{ color:"#bbb", textDecoration:"underline" }}>Unsubscribe</span> · <span style={{ color:"#bbb", textDecoration:"underline" }}>Privacy Policy</span>
          </div>
        </div>
      );
      default: return null;
    }
  };

  return (
    <div>
      {/* Email chrome */}
      <div style={{ background:"#EEF2F7", borderRadius:"16px 16px 0 0", padding:"12px 16px", display:"flex", alignItems:"center", gap:10, border:"1px solid #e0e0e0", borderBottom:"none" }}>
        <div style={{ display:"flex", gap:6 }}>
          {["#ff6b6b","#f9ca24","#00b894"].map(c=><div key={c} style={{ width:12,height:12,borderRadius:"50%",background:c }} />)}
        </div>
        <div style={{ flex:1, background:"#fff", borderRadius:8, padding:"4px 12px", fontSize:11, color:"#888" }}>
          📧 {template.subject}
        </div>
      </div>

      {/* Email body */}
      <div style={{ background:"#fff", border:"1px solid #e0e0e0", borderRadius:"0 0 16px 16px", overflow:"hidden" }}>
        {/* Email header */}
        <div style={{ background:"#2C3E50", padding:"20px", textAlign:"center" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
            <div style={{ width:32, height:32, borderRadius:8, overflow:"hidden", background:"#1a1d21" }}>
              <img src={LOGO_IMG} alt="In Hand" style={{ width:"100%", height:"100%", objectFit:"contain" }} />
            </div>
            <span style={{ fontWeight:900, fontSize:18, color:"#fff" }}>In <span style={{ color:"#3A7BD5" }}>Hand</span></span>
          </div>
        </div>

        {/* Email content */}
        <div style={{ padding:"20px" }}>
          <div style={{ fontSize:11, color:"#bbb", marginBottom:16 }}>To: collector@email.com · {template.to}</div>
          {template.sections.map(renderSection)}
        </div>
      </div>
    </div>
  );
}

function EmailTemplatesScreen({ onBack }) {
  const [selected, setSelected] = useState(EMAIL_TEMPLATES[0]);

  return (
    <div style={{ flex:1, overflowY:"auto", padding:"20px 20px 90px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
        <button onClick={onBack} style={{ background:"#E4EBF2",border:"none",borderRadius:10,padding:"6px 12px",fontSize:12,fontWeight:700,color:"#555",cursor:"pointer" }}>← Account</button>
        <div style={{ fontWeight:800, fontSize:18, color:"#2C3E50" }}>📧 Email Templates</div>
      </div>
      <div style={{ fontSize:12, color:"#bbb", marginBottom:16 }}>Reference for your dev · powered by Resend or Supabase</div>

      {/* Template selector */}
      <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:8, marginBottom:20 }}>
        {EMAIL_TEMPLATES.map(t=>(
          <div key={t.id} onClick={()=>setSelected(t)} style={{ flexShrink:0, background:selected.id===t.id?t.color:"#fff", border:`2px solid ${selected.id===t.id?t.color:"#E4EBF2"}`, borderRadius:14, padding:"8px 14px", cursor:"pointer", transition:"all 0.15s", display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ fontSize:16 }}>{t.icon}</span>
            <div>
              <div style={{ fontSize:11, fontWeight:800, color:selected.id===t.id?"#fff":"#2C3E50", whiteSpace:"nowrap" }}>{t.trigger}</div>
              <div style={{ fontSize:9, color:selected.id===t.id?"rgba(255,255,255,0.7)":"#bbb", whiteSpace:"nowrap" }}>→ {t.to}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Dev integration note */}
      <div style={{ background:"#EAF1FA", borderRadius:14, padding:"12px 14px", marginBottom:20, display:"flex", gap:10 }}>
        <span style={{ fontSize:18 }}>⚡</span>
        <div>
          <div style={{ fontWeight:700, fontSize:12, color:"#3A7BD5" }}>Dev: wire with Resend</div>
          <div style={{ fontSize:11, color:"#888", marginTop:2, lineHeight:1.5 }}>
            <code style={{ background:"#D6E8F5", borderRadius:4, padding:"1px 5px", fontSize:10 }}>npm install resend</code> · Each trigger calls <code style={{ background:"#D6E8F5", borderRadius:4, padding:"1px 5px", fontSize:10 }}>resend.emails.send({"{"} to, subject, html {"}"} )</code> from a Supabase Edge Function. Sender: <strong>noreply@inhand.app</strong>
          </div>
        </div>
      </div>

      {/* Email preview */}
      <EmailTemplatePreview template={selected} />
    </div>
  );
}

// ─── AUTH SCREENS ─────────────────────────────────────────────────────────────
const IS_AUTH = { background:"#f7f7f7", border:"1.5px solid #DCE6F0", borderRadius:14, padding:"12px 16px", fontSize:14, fontFamily:"'Poppins',sans-serif", fontWeight:500, color:"#2C3E50", width:"100%", outline:"none" };

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");       // login | signup | signup_confirm | forgot | reset
  const [form, setForm] = useState({ email:"", password:"", username:"", avatar:"🦖" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  /** Email used for signup_confirm resend (Supabase sends confirmation link, not a mock code). */
  const [signupEmail, setSignupEmail] = useState("");
  const setF = (k,v) => { setForm(f=>({...f,[k]:v})); setError(""); setInfo(""); };

  const handleSignup = async () => {
    if (!form.email || !form.password || !form.username) { setError("All fields are required"); return; }
    if (!form.email.includes("@")) { setError("Enter a valid email address"); return; }
    if (form.password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (form.username.length < 3) { setError("Username must be at least 3 characters"); return; }
    if (!supabase) { setError("Supabase is not configured."); return; }
    setLoading(true);
    setError("");
    setInfo("");
    try {
      const { data, error: signErr } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: {
          emailRedirectTo: getAuthRedirectUrl(),
          data: {
            username: form.username.trim(),
            avatar: form.avatar,
          },
        },
      });
      if (signErr) throw signErr;
      setSignupEmail(form.email.trim());
      if (data.session && data.user) {
        const profile = await ensureUserProfile(data.user);
        onAuth(profile);
        return;
      }
      setMode("signup_confirm");
    } catch (err) {
      setError(err?.message || "Sign up failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleResendSignupEmail = async () => {
    if (!supabase || !signupEmail) return;
    setLoading(true);
    setError("");
    try {
      const { error: resendErr } = await supabase.auth.resend({
        type: "signup",
        email: signupEmail,
        options: { emailRedirectTo: getAuthRedirectUrl() },
      });
      if (resendErr) throw resendErr;
      setInfo("Another confirmation email is on its way.");
    } catch (err) {
      setError(err?.message || "Could not resend email.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!form.email || !form.password) { setError("Enter your email and password"); return; }
    if (!form.email.includes("@")) { setError("Enter a valid email address"); return; }
    if (!supabase) { setError("Sign-in requires Supabase configuration."); return; }
    setLoading(true);
    setError("");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password,
      });
      if (error) throw error;
      // Profile + setAuthUser: parent `onAuthStateChange` only — avoids a second
      // concurrent session/read path that races the auth storage lock.
    } catch (err) {
      setError(err?.message || "Sign-in failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async () => {
    if (!form.email.includes("@")) { setError("Enter your email address"); return; }
    if (!supabase) { setError("Supabase is not configured."); return; }
    setLoading(true);
    setError("");
    setInfo("");
    try {
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(form.email.trim(), {
        redirectTo: getAuthRedirectUrl(),
      });
      if (resetErr) throw resetErr;
      setInfo("If that email is registered, we sent a reset link. Check your inbox and spam.");
      setMode("login");
    } catch (err) {
      setError(err?.message || "Could not send reset email.");
    } finally {
      setLoading(false);
    }
  };

  const Spinner = () => <div style={{ width:20,height:20,border:"3px solid rgba(255,255,255,0.3)",borderTop:"3px solid #fff",borderRadius:"50%",animation:"spin 0.8s linear infinite",display:"inline-block" }} />;

  return (
    <div className="inhand-auth-screen">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        input:focus{outline:none;border-color:#2C3E50 !important;}
      `}</style>

      {/* Logo */}
      <div style={{ textAlign:"center", marginBottom:40, animation:"fadeUp 0.4s ease" }}>
        <div style={{ width:110, height:110, borderRadius:28, overflow:"hidden", margin:"0 auto 16px", boxShadow:"0 8px 32px rgba(0,0,0,0.25)", background:"#1a1d21" }}>
              <img src={LOGO_IMG} alt="In Hand" style={{ width:"100%", height:"100%", objectFit:"contain" }} />
            </div>
        <div style={{ fontSize:12, color:"#bbb", fontWeight:600, marginTop:4, letterSpacing:1 }}>ACTION FIGURE EXCHANGE</div>
      </div>

      {/* Card */}
      <div style={{ background:"#fff", borderRadius:28, padding:"28px 24px", width:"100%", boxShadow:"0 8px 40px rgba(0,0,0,0.08)", animation:"fadeUp 0.5s ease 0.1s both" }}>

        {/* ── LOGIN ── */}
        {mode==="login" && (
          <>
            <div style={{ fontWeight:800, fontSize:22, color:"#2C3E50", marginBottom:6 }}>Welcome back 👋</div>
            <div style={{ fontSize:13, color:"#aaa", marginBottom:24 }}>Sign in to your In Hand account</div>
            <div style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:16 }}>
              <input value={form.email} onChange={e=>setF("email",e.target.value)} placeholder="Email address" type="email" style={IS_AUTH} />
              <input value={form.password} onChange={e=>setF("password",e.target.value)} placeholder="Password" type="password" style={IS_AUTH}
                onKeyDown={e=>e.key==="Enter"&&handleLogin()} />
            </div>
            {error && <div style={{ color:"#ff6b6b", fontSize:12, fontWeight:600, marginBottom:12 }}>⚠️ {error}</div>}
            {info && <div style={{ color:"#00b894", fontSize:12, fontWeight:600, marginBottom:12 }}>{info}</div>}
            <button onClick={()=>{setMode("forgot");setError("");setInfo("");}} style={{ fontSize:12, color:"#aaa", background:"none", border:"none", cursor:"pointer", marginBottom:20, padding:0, fontFamily:"'Poppins',sans-serif" }}>Forgot password?</button>
            <button onClick={handleLogin} disabled={loading} style={{ width:"100%", background:"#2C3E50", border:"none", borderRadius:14, padding:"14px", color:"#fff", fontWeight:800, fontSize:15, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:10, marginBottom:16 }}>
              {loading ? <Spinner /> : "Sign In"}
            </button>
            <div style={{ textAlign:"center", fontSize:13, color:"#aaa" }}>
              No account? <span onClick={()=>{setMode("signup");setError("");setInfo("");}} style={{ color:"#4A90D9", fontWeight:700, cursor:"pointer" }}>Sign up free</span>
            </div>
            <div style={{ marginTop:20, background:"#EAF1FA", borderRadius:12, padding:"10px 14px", fontSize:11, color:"#3A7BD5", textAlign:"center", fontWeight:600, lineHeight:1.5 }}>
              Use the email and password you registered with. New accounts get a confirmation link by email before first sign-in.
            </div>
          </>
        )}

        {/* ── SIGNUP ── */}
        {mode==="signup" && (
          <>
            <div style={{ fontWeight:800, fontSize:22, color:"#2C3E50", marginBottom:6 }}>Create account</div>
            <div style={{ fontSize:13, color:"#aaa", marginBottom:20 }}>Join the collector community</div>

            {/* Avatar picker */}
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"#aaa", marginBottom:8, letterSpacing:0.8 }}>PICK YOUR AVATAR</div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {AVATARS.map(a=>(
                  <div key={a} onClick={()=>setF("avatar",a)} style={{ width:40, height:40, borderRadius:12, background:form.avatar===a?"#2C3E50":"#EEF2F7", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, cursor:"pointer", transition:"all 0.15s", border:form.avatar===a?"2px solid #2C3E50":"2px solid transparent" }}>{a}</div>
                ))}
              </div>
            </div>

            <div style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:16 }}>
              <input value={form.username} onChange={e=>setF("username",e.target.value)} placeholder="Username (e.g. RetroCollector88)" style={IS_AUTH} />
              <input value={form.email} onChange={e=>setF("email",e.target.value)} placeholder="Email address" type="email" style={IS_AUTH} />
              <input value={form.password} onChange={e=>setF("password",e.target.value)} placeholder="Password (min 8 characters)" type="password" style={IS_AUTH} />
            </div>

            {/* Terms */}
            <div style={{ background:"#f9f9f9", borderRadius:12, padding:"10px 14px", marginBottom:16, fontSize:11, color:"#888", lineHeight:1.5 }}>
              By signing up you agree to our <span style={{ color:"#3A7BD5", fontWeight:700, cursor:"pointer" }}>Terms of Service</span> and <span style={{ color:"#3A7BD5", fontWeight:700, cursor:"pointer" }}>Privacy Policy</span>. All transactions are protected by In Hand escrow.
            </div>

            {error && <div style={{ color:"#ff6b6b", fontSize:12, fontWeight:600, marginBottom:12 }}>⚠️ {error}</div>}
            {info && <div style={{ color:"#00b894", fontSize:12, fontWeight:600, marginBottom:12 }}>{info}</div>}
            <button onClick={handleSignup} disabled={loading} style={{ width:"100%", background:"linear-gradient(135deg,#4A90D9,#f0932b)", border:"none", borderRadius:14, padding:"14px", color:"#fff", fontWeight:800, fontSize:15, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:10, marginBottom:16, boxShadow:"0 4px 16px rgba(253,121,168,0.4)" }}>
              {loading ? <Spinner /> : "Create Account →"}
            </button>
            <div style={{ textAlign:"center", fontSize:13, color:"#aaa" }}>
              Already have one? <span onClick={()=>{setMode("login");setError("");setInfo("");}} style={{ color:"#2C3E50", fontWeight:700, cursor:"pointer" }}>Sign in</span>
            </div>
          </>
        )}

        {/* ── SIGNUP: confirm via email link (Supabase + Resend SMTP) ── */}
        {mode==="signup_confirm" && (
          <>
            <div style={{ textAlign:"center", marginBottom:20 }}>
              <div style={{ fontSize:52, marginBottom:12 }}>📧</div>
              <div style={{ fontWeight:800, fontSize:20, color:"#2C3E50", marginBottom:6 }}>Confirm your email</div>
              <div style={{ fontSize:13, color:"#aaa", lineHeight:1.6 }}>
                We sent a <strong style={{ color:"#2C3E50" }}>confirmation link</strong> to<br/>
                <strong style={{ color:"#2C3E50" }}>{signupEmail}</strong>
                <br /><br />
                Open the email and tap the link — on iPhone it should open the <strong>In Hand</strong> app directly.
                Then sign in with the password you chose.
              </div>
            </div>
            {error && <div style={{ color:"#ff6b6b", fontSize:12, fontWeight:600, marginBottom:12, textAlign:"center" }}>⚠️ {error}</div>}
            {info && <div style={{ color:"#00b894", fontSize:12, fontWeight:600, marginBottom:12, textAlign:"center" }}>{info}</div>}
            <button onClick={()=>{ setMode("login"); setError(""); setInfo(""); }} style={{ width:"100%", background:"#2C3E50", border:"none", borderRadius:14, padding:"14px", color:"#fff", fontWeight:800, fontSize:15, cursor:"pointer", marginBottom:12 }}>
              Back to sign in
            </button>
            <div style={{ textAlign:"center", marginBottom:8 }}>
              <span style={{ fontSize:12, color:"#aaa" }}>Didn’t get it? </span>
              <span onClick={handleResendSignupEmail} style={{ fontSize:12, color:"#3A7BD5", fontWeight:700, cursor:"pointer" }}>Resend email</span>
            </div>
            <div style={{ marginTop:16, background:"#f9f9f9", borderRadius:12, padding:"10px 14px", fontSize:11, color:"#888", textAlign:"center", lineHeight:1.5 }}>
              Check spam/promotions. Auth emails go through your Supabase SMTP (e.g. Resend).
            </div>
          </>
        )}

        {/* ── FORGOT PASSWORD ── */}
        {mode==="forgot" && (
          <>
            <div style={{ fontWeight:800, fontSize:22, color:"#2C3E50", marginBottom:6 }}>Reset password</div>
            <div style={{ fontSize:13, color:"#aaa", marginBottom:24 }}>Enter your email and we will send a reset link</div>
            <input value={form.email} onChange={e=>setF("email",e.target.value)} placeholder="Email address" type="email" style={{...IS_AUTH, marginBottom:16}} />
            {error && <div style={{ color:"#ff6b6b", fontSize:12, fontWeight:600, marginBottom:12 }}>⚠️ {error}</div>}
            {info && <div style={{ color:"#00b894", fontSize:12, fontWeight:600, marginBottom:12 }}>{info}</div>}
            <button onClick={handleForgot} disabled={loading} style={{ width:"100%", background:"#2C3E50", border:"none", borderRadius:14, padding:"14px", color:"#fff", fontWeight:800, fontSize:15, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:10, marginBottom:16 }}>
              {loading ? <Spinner /> : "Send reset link"}
            </button>
            <div style={{ textAlign:"center", fontSize:13, color:"#aaa" }}>
              <span onClick={()=>{setMode("login");setError("");setInfo("");}} style={{ color:"#2C3E50", fontWeight:700, cursor:"pointer" }}>← Back to login</span>
            </div>
            <div style={{ marginTop:16, fontSize:11, color:"#bbb", textAlign:"center", lineHeight:1.5 }}>
              We email a secure link (not a fake code). Use the link, then sign in with your new password.
            </div>
          </>
        )}

        {/* ── RESET PASSWORD (link in email; Supabase handles token on return) ── */}
        {mode==="reset" && (
          <>
            <div style={{ fontWeight:800, fontSize:22, color:"#2C3E50", marginBottom:6 }}>Check your email</div>
            <div style={{ fontSize:13, color:"#aaa", marginBottom:20, lineHeight:1.6 }}>
              Password reset uses a <strong style={{ color:"#2C3E50" }}>link</strong> from Supabase (via your SMTP). After you set a new password in the browser tab that opens, come back here and sign in.
            </div>
            {error && <div style={{ color:"#ff6b6b", fontSize:12, fontWeight:600, marginBottom:12 }}>⚠️ {error}</div>}
            <button onClick={()=>{ setMode("login"); setError(""); setInfo(""); }} style={{ width:"100%", background:"#2C3E50", border:"none", borderRadius:14, padding:"14px", color:"#fff", fontWeight:800, fontSize:15, cursor:"pointer", marginBottom:16 }}>
              Back to sign in
            </button>
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{ marginTop:24, fontSize:11, color:"#ccc", textAlign:"center", lineHeight:1.6 }}>
        🔒 Your data is encrypted and protected<br/>
        All payments secured by Stripe escrow
      </div>
    </div>
  );
}

// ─── SHARE MODAL ─────────────────────────────────────────────────────────────
function ShareModal({ card, owner, onClose, onOpenListingVideo }) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(null);
  const { from } = lc(card.line);
  const conditionText = condLabel(card.isNew);
  const shareUrl = getListingShareUrl(card.id);
  const shareText = `🔥 ${card.name} — ${conditionText} — $${card.value}\nAvailable on In Hand, the action figure exchange.\n${shareUrl}`;

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(shareUrl); } catch {}
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const shareToApp = (platform) => {
    const et = encodeURIComponent(shareText), eu = encodeURIComponent(shareUrl);
    const urls = { twitter:`https://twitter.com/intent/tweet?text=${et}`, reddit:`https://reddit.com/submit?url=${eu}&title=${encodeURIComponent(card.name)}`, facebook:`https://www.facebook.com/sharer/sharer.php?u=${eu}`, whatsapp:`https://wa.me/?text=${et}` };
    if (urls[platform]) window.open(urls[platform], "_blank");
    setShared(platform); setTimeout(() => setShared(null), 1500);
  };

  const nativeShare = async () => {
    const blurb = `🔥 ${card.name} — ${conditionText} — $${card.value}\nAvailable on In Hand, the action figure exchange.`;
    if (navigator.share) {
      try {
        await navigator.share({ title: card.name, text: blurb, url: shareUrl });
      } catch {
        /* cancelled */
      }
    } else {
      copyLink();
    }
  };

  const PLATFORMS = [
    { id:"whatsapp", label:"WhatsApp",   icon:"💬", bg:"#25D366", color:"#fff" },
    { id:"reddit",   label:"Reddit",     icon:"🤖", bg:"#FF4500", color:"#fff" },
    { id:"twitter",  label:"X / Twitter",icon:"✖", bg:"#000",    color:"#fff" },
    { id:"facebook", label:"Facebook",   icon:"📘", bg:"#1877F2", color:"#fff" },
  ];

  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:700,display:"flex",alignItems:"flex-end",justifyContent:"center" }}>
      <div style={{ background:"#fff",borderRadius:"28px 28px 0 0",padding:"24px 20px 44px",width:"100%",maxWidth:430 }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20 }}>
          <div style={{ fontWeight:800,fontSize:18,color:"#2C3E50" }}>Share Listing</div>
          <button onClick={onClose} style={{ background:"#E4EBF2",border:"none",borderRadius:"50%",width:32,height:32,fontSize:16,cursor:"pointer" }}>✕</button>
        </div>

        {/* Listing preview */}
        <div style={{ background:"#f9f9f9",borderRadius:18,padding:"14px",marginBottom:20,display:"flex",gap:12,alignItems:"center" }}>
          <FigureImage card={card} size={56} borderRadius={14} onVideoOpen={onOpenListingVideo} />
          <div style={{ flex:1,minWidth:0 }}>
            <div style={{ fontWeight:800,fontSize:14,color:"#2C3E50",lineHeight:1.2 }}>{card.name}</div>
            <div style={{ fontSize:11,color:"#aaa",marginTop:2 }}>{card.line}</div>
            <div style={{ display:"flex",gap:6,marginTop:5,alignItems:"center" }}>
              <span style={{ fontSize:10,fontWeight:800,background:condBg(card.isNew),color:condColor(card.isNew),borderRadius:6,padding:"2px 7px" }}>{conditionText}</span>
              <span style={{ fontWeight:800,fontSize:13,color:from }}>${card.value}</span>
            </div>
          </div>
          {owner && (
            <div style={{ textAlign:"center", flexShrink:0 }}>
              <div style={{ fontSize:22 }}>{owner.avatar}</div>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, marginTop:2 }}>
                <div style={{ fontSize:9, color:"#bbb", fontWeight:700 }}>{owner.username.split("_")[0]}</div>
                {owner.verified && <VerifiedInHandBadge compact />}
              </div>
            </div>
          )}
        </div>

        {/* Native share */}
        <button onClick={nativeShare} style={{ width:"100%",background:"#2C3E50",border:"none",borderRadius:14,padding:"13px",color:"#fff",fontWeight:800,fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:16,boxShadow:"0 4px 14px rgba(26,26,46,0.25)" }}>
          <span style={{ fontSize:18 }}>↗️</span> Share via…
        </button>

        {/* Platform grid */}
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:16 }}>
          {PLATFORMS.map(p=>(
            <button key={p.id} onClick={()=>shareToApp(p.id)} style={{ background:shared===p.id?"#f0fff8":p.bg,border:"none",borderRadius:14,padding:"12px 6px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:5,transition:"all 0.15s" }}>
              <span style={{ fontSize:22 }}>{shared===p.id?"✓":p.icon}</span>
              <span style={{ fontSize:9,fontWeight:700,color:shared===p.id?"#00b894":p.color,textAlign:"center",lineHeight:1.2 }}>{p.label}</span>
            </button>
          ))}
        </div>

        {/* Copy link row */}
        <div style={{ background:"#EEF2F7",borderRadius:14,padding:"12px 14px",display:"flex",alignItems:"center",gap:10,marginBottom:12 }}>
          <span style={{ fontSize:16 }}>🔗</span>
          <span style={{ flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:11,color:"#888",fontFamily:"monospace" }}>{shareUrl}</span>
          <button onClick={copyLink} style={{ background:copied?"#00b894":"#2C3E50",border:"none",borderRadius:8,padding:"6px 14px",color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer",flexShrink:0,transition:"background 0.2s" }}>{copied?"✓ Copied":"Copy"}</button>
        </div>

        {/* Share text preview */}
        <div style={{ background:"#f9f9f9",borderRadius:12,padding:"10px 14px",marginBottom:10 }}>
          <div style={{ fontSize:10,fontWeight:700,color:"#aaa",marginBottom:5,letterSpacing:0.8 }}>SHARE TEXT</div>
          <div style={{ fontSize:11,color:"#555",lineHeight:1.6,whiteSpace:"pre-line" }}>{shareText}</div>
        </div>

        <div style={{ fontSize:10,color:"#ccc",textAlign:"center" }}>
          📸 Instagram: tap "Share via…" on mobile or copy the link and paste in your story
        </div>
      </div>
    </div>
  );
}

// ─── EDIT PROFILE MODAL ───────────────────────────────────────────────────────
function EditProfileModal({ user, initialTab = "profile", onSave, onExportData, onDeactivate, onDeleteAccount, onClose }) {
  const [form, setForm] = useState({
    username:  user.username  || "",
    avatar:    user.avatar    || "🦖",
    location:  user.location  || "",
    wishlist:  user.wishlist?.join(", ") || "",
  });
  const [tab, setTab] = useState(initialTab);
  useEffect(() => { setTab(initialTab); }, [initialTab]);
  const setF = (k,v) => setForm(f=>({...f,[k]:v}));

  const handleSave = () => {
    if (!form.username.trim()) return;
    onSave({
      username: form.username.trim(),
      avatar:   form.avatar,
      location: form.location.trim(),
      wishlist: form.wishlist.split(",").map(t=>t.trim().toLowerCase()).filter(Boolean),
    });
    onClose();
  };

  const TABS = [
    { id:"profile",  label:"Profile"  },
    { id:"avatar",   label:"Avatar"   },
    { id:"wishlist", label:"Wishlist" },
    { id:"danger",   label:"⚠️ Account" },
  ];

  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:700,display:"flex",alignItems:"flex-end",justifyContent:"center" }}>
      <div style={{ background:"#fff",borderRadius:"28px 28px 0 0",padding:"24px 20px 44px",width:"100%",maxWidth:430,maxHeight:"90vh",overflowY:"auto" }}>

        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
          <div>
            <div style={{ fontWeight:800, fontSize:18, color:"#2C3E50" }}>Edit Account</div>
            {user?.verified && (
              <div style={{ marginTop:8 }}>
                <VerifiedInHandBadge />
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background:"#E4EBF2",border:"none",borderRadius:"50%",width:32,height:32,fontSize:16,cursor:"pointer" }}>✕</button>
        </div>

        {/* Sub-tabs */}
        <div style={{ display:"flex",background:"#DCE6F0",borderRadius:12,padding:4,gap:2,marginBottom:20 }}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{ flex:1,background:tab===t.id?"#fff":"transparent",border:"none",borderRadius:8,padding:"7px 2px",fontSize:10,fontWeight:tab===t.id?800:600,color:tab===t.id?t.id==="danger"?"#ff6b6b":"#2C3E50":"#aaa",cursor:"pointer",transition:"all 0.15s" }}>{t.label}</button>
          ))}
        </div>

        {/* ── PROFILE TAB ── */}
        {tab==="profile" && (
          <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
            {/* Preview */}
            <div style={{ background:"#f9f9f9",borderRadius:16,padding:"16px",display:"flex",alignItems:"center",gap:14,marginBottom:4 }}>
              <div style={{ width:54,height:54,borderRadius:"50%",background:"#2C3E50",display:"flex",alignItems:"center",justifyContent:"center",fontSize:30,flexShrink:0 }}>{form.avatar}</div>
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                  <div style={{ fontWeight:800,fontSize:16,color:"#2C3E50" }}>{form.username||"Your name"}</div>
                  {user?.verified && <VerifiedInHandBadge compact />}
                </div>
                <div style={{ fontSize:12,color:"#aaa",marginTop:2 }}>{form.location||"Location not set"}</div>
              </div>
            </div>
            <div>
              <div style={{ fontSize:11,fontWeight:700,color:"#aaa",marginBottom:6,letterSpacing:0.8 }}>USERNAME</div>
              <input value={form.username} onChange={e=>setF("username",e.target.value)} placeholder="Username *" style={IS} />
              <div style={{ fontSize:10,color:"#ccc",marginTop:4 }}>Changing your username may affect your profile link</div>
            </div>
            <div>
              <div style={{ fontSize:11,fontWeight:700,color:"#aaa",marginBottom:6,letterSpacing:0.8 }}>LOCATION</div>
              <input value={form.location} onChange={e=>setF("location",e.target.value)} placeholder="e.g. Brooklyn, NY" style={IS} />
            </div>
            <Btn onClick={handleSave} style={{ background:"#2C3E50",color:"#fff",width:"100%",marginTop:8 }}>Save Changes</Btn>
          </div>
        )}

        {/* ── AVATAR TAB ── */}
        {tab==="avatar" && (
          <div>
            <div style={{ fontSize:13,color:"#888",marginBottom:16,textAlign:"center" }}>Choose your collector avatar</div>
            <div style={{ display:"flex",flexWrap:"wrap",gap:10,justifyContent:"center",marginBottom:20 }}>
              {AVATARS.map(a=>(
                <div key={a} onClick={()=>setF("avatar",a)} style={{ width:52,height:52,borderRadius:14,background:form.avatar===a?"#2C3E50":"#EEF2F7",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,cursor:"pointer",transition:"all 0.15s",boxShadow:form.avatar===a?"0 4px 12px rgba(26,26,46,0.3)":"none",transform:form.avatar===a?"scale(1.1)":"scale(1)" }}>{a}</div>
              ))}
            </div>
            <div style={{ background:"#f9f9f9",borderRadius:14,padding:"14px",textAlign:"center",marginBottom:16 }}>
              <div style={{ fontSize:48,marginBottom:8 }}>{form.avatar}</div>
              <div style={{ fontSize:12,color:"#aaa" }}>Your selected avatar</div>
            </div>
            <Btn onClick={handleSave} style={{ background:"#2C3E50",color:"#fff",width:"100%" }}>Save Avatar</Btn>
          </div>
        )}

        {/* ── WISHLIST TAB ── */}
        {tab==="wishlist" && (
          <div>
            <div style={{ background:"#EAF1FA",borderRadius:14,padding:"12px 14px",marginBottom:16,display:"flex",gap:8 }}>
              <span style={{ fontSize:16 }}>💡</span>
              <div style={{ fontSize:12,color:"#3A7BD5",lineHeight:1.5 }}>
                Wishlist tags are used by the matching algorithm. You'll get notified when a figure matching your tags is listed.
              </div>
            </div>
            <div style={{ fontSize:11,fontWeight:700,color:"#aaa",marginBottom:8,letterSpacing:0.8 }}>YOUR WISHLIST TAGS</div>
            <textarea
              value={form.wishlist}
              onChange={e=>setF("wishlist",e.target.value)}
              placeholder="vintage, hasbro, G.I. Joe, starwars, tmnt, motu…"
              rows={3}
              style={{...IS,resize:"none",lineHeight:1.5,marginBottom:10}}
            />
            {/* Tag preview */}
            {form.wishlist && (
              <div style={{ display:"flex",gap:6,flexWrap:"wrap",marginBottom:16 }}>
                {form.wishlist.split(",").map(t=>t.trim().toLowerCase()).filter(Boolean).map((t,i)=>(
                  <span key={i} style={{ fontSize:11,background:"#EAF1FA",color:"#3A7BD5",borderRadius:20,padding:"4px 12px",fontWeight:700,border:"1.5px solid #DCE6F0" }}>#{t}</span>
                ))}
              </div>
            )}
            {/* Suggested tags */}
            <div style={{ fontSize:11,fontWeight:700,color:"#aaa",marginBottom:8 }}>POPULAR TAGS</div>
            <div style={{ display:"flex",gap:6,flexWrap:"wrap",marginBottom:20 }}>
              {["vintage","hasbro","kenner","G.I. Joe","starwars","tmnt","motu","transformers","playmates","rare","boxed","complete"].map(tag=>{
                const already = form.wishlist.toLowerCase().includes(tag);
                return (
                  <button key={tag} onClick={()=>{ if(!already) setF("wishlist", form.wishlist ? form.wishlist+", "+tag : tag); }} style={{ background:already?"#2C3E50":"#EEF2F7",border:"none",borderRadius:20,padding:"5px 12px",fontSize:11,fontWeight:700,color:already?"#fff":"#888",cursor:already?"default":"pointer" }}>
                    {already?"✓ ":""}{tag}
                  </button>
                );
              })}
            </div>
            <Btn onClick={handleSave} style={{ background:"#2C3E50",color:"#fff",width:"100%" }}>Save Wishlist</Btn>
          </div>
        )}

        {/* ── DANGER ZONE ── */}
        {tab==="danger" && (
          <div>
            <div style={{ background:"#fff0f0",border:"2px solid #ff6b6b",borderRadius:16,padding:"16px",marginBottom:16 }}>
              <div style={{ fontWeight:800,fontSize:14,color:"#ff6b6b",marginBottom:8 }}>⚠️ Danger Zone</div>
              <div style={{ fontSize:12,color:"#888",lineHeight:1.6 }}>These actions are permanent. Please be sure before proceeding.</div>
            </div>

            {/* Deactivate */}
            <div style={{ background:"#fff",borderRadius:16,padding:"16px",border:"1px solid #E4EBF2",marginBottom:10 }}>
              <div style={{ fontWeight:700,fontSize:14,color:"#2C3E50",marginBottom:4 }}>Deactivate Account</div>
              <div style={{ fontSize:12,color:"#aaa",marginBottom:12 }}>Your listings will be hidden but your account data is preserved. You can reactivate anytime.</div>
              <button type="button" onClick={() => { onDeactivate?.(); onClose(); }} style={{ background:"#fff8e6",border:"2px solid #f9ca24",borderRadius:10,padding:"9px 18px",fontSize:12,fontWeight:700,color:"#f0932b",cursor:"pointer" }}>Deactivate</button>
            </div>

            {/* Delete */}
            <div style={{ background:"#fff",borderRadius:16,padding:"16px",border:"1px solid #E4EBF2",marginBottom:10 }}>
              <div style={{ fontWeight:700,fontSize:14,color:"#ff6b6b",marginBottom:4 }}>Delete Account</div>
              <div style={{ fontSize:12,color:"#aaa",marginBottom:12 }}>Permanently deletes your account, all listings, and transaction history. This cannot be undone.</div>
              <button type="button" onClick={() => { if (window.confirm("Permanently delete your account and all listings? This cannot be undone.")) { onDeleteAccount?.(); onClose(); } }} style={{ background:"#fff0f0",border:"2px solid #ff6b6b",borderRadius:10,padding:"9px 18px",fontSize:12,fontWeight:700,color:"#ff6b6b",cursor:"pointer" }}>Delete Account</button>
            </div>

            {/* Export data */}
            <div style={{ background:"#fff",borderRadius:16,padding:"16px",border:"1px solid #E4EBF2" }}>
              <div style={{ fontWeight:700,fontSize:14,color:"#2C3E50",marginBottom:4 }}>Export My Data</div>
              <div style={{ fontSize:12,color:"#aaa",marginBottom:12 }}>Download a copy of all your data — listings, transactions, messages, and ratings.</div>
              <button type="button" onClick={() => { onExportData?.(); }} style={{ background:"#EAF1FA",border:"2px solid #3A7BD5",borderRadius:10,padding:"9px 18px",fontSize:12,fontWeight:700,color:"#3A7BD5",cursor:"pointer" }}>📥 Export Data</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── NOTIFICATION CENTER ──────────────────────────────────────────────────────
function NotificationCenter({ notifications, onMarkRead, onMarkAllRead, onClose, onNavigate }) {
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:800,display:"flex",justifyContent:"flex-end" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#EEF2F7",width:"88%",maxWidth:380,height:"100%",display:"flex",flexDirection:"column",boxShadow:"-8px 0 40px rgba(0,0,0,0.15)" }}>

        {/* Header */}
        <div style={{ background:"#fff",borderBottom:"1px solid #E4EBF2",padding:"20px 20px 14px",display:"flex",alignItems:"center",justifyContent:"space-between" }}>
          <div>
            <div style={{ fontWeight:800,fontSize:18,color:"#2C3E50" }}>Notifications 🔔</div>
            <div style={{ fontSize:11,color:"#aaa",marginTop:2 }}>{notifications.filter(n=>!n.read).length} unread</div>
          </div>
          <div style={{ display:"flex",gap:8 }}>
            {notifications.some(n=>!n.read) && (
              <button onClick={onMarkAllRead} style={{ background:"#EAF1FA",border:"none",borderRadius:10,padding:"6px 12px",fontSize:11,fontWeight:700,color:"#3A7BD5",cursor:"pointer" }}>All read</button>
            )}
            <button onClick={onClose} style={{ background:"#E4EBF2",border:"none",borderRadius:"50%",width:32,height:32,fontSize:16,cursor:"pointer" }}>✕</button>
          </div>
        </div>


        {/* Notification list */}
        <div style={{ flex:1,overflowY:"auto",padding:"12px 16px 40px" }}>
          {notifications.length === 0 ? (
            <div style={{ textAlign:"center",padding:"60px 0" }}>
              <div style={{ fontSize:48,marginBottom:14 }}>🔔</div>
              <div style={{ fontWeight:700,fontSize:15,color:"#bbb" }}>All caught up!</div>
              <div style={{ fontSize:12,color:"#ccc",marginTop:4 }}>New activity will appear here</div>
            </div>
          ) : notifications.map(n => {
            const nt = NOTIF_TYPES[n.type] || { icon:"🔔",color:"#aaa",label:"Notification" };
            return (
              <div key={n.id}
                onClick={()=>{ onMarkRead(n.id); onNavigate(n.link); onClose(); }}
                style={{ background:n.read?"#fff":"#fff",borderRadius:16,padding:"12px 14px",marginBottom:10,boxShadow:"0 2px 10px rgba(0,0,0,0.05)",border:`1px solid ${n.read?"#E4EBF2":nt.color+"33"}`,cursor:"pointer",display:"flex",gap:12,alignItems:"flex-start",transition:"all 0.15s",position:"relative" }}
                onMouseEnter={e=>e.currentTarget.style.transform="translateX(-2px)"}
                onMouseLeave={e=>e.currentTarget.style.transform="translateX(0)"}
              >
                {/* Unread dot */}
                {!n.read && <div style={{ position:"absolute",top:12,right:12,width:8,height:8,borderRadius:"50%",background:nt.color }} />}

                {/* Icon */}
                <div style={{ width:40,height:40,borderRadius:12,background:`${nt.color}15`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0 }}>{nt.icon}</div>

                {/* Content */}
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ fontWeight:n.read?600:800,fontSize:13,color:"#2C3E50",marginBottom:3 }}>{n.title}</div>
                  <div style={{ fontSize:11,color:"#888",lineHeight:1.4 }}>{n.body}</div>
                  <div style={{ fontSize:10,color:"#ccc",marginTop:5 }}>{n.ts}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Notification settings */}
        <div style={{ borderTop:"1px solid #E4EBF2",padding:"14px 20px",background:"#fff" }}>
          <div style={{ fontWeight:700,fontSize:12,color:"#aaa",marginBottom:10,letterSpacing:0.8 }}>NOTIFICATION SETTINGS</div>
          <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
            {Object.entries(NOTIF_TYPES).map(([key,nt])=>(
              <div key={key} style={{ display:"flex",alignItems:"center",justifyContent:"space-between" }}>
                <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                  <span style={{ fontSize:16 }}>{nt.icon}</span>
                  <span style={{ fontSize:12,color:"#555",fontWeight:500 }}>{nt.label}</span>
                </div>
                <div style={{ width:36,height:20,borderRadius:10,background:nt.color,display:"flex",alignItems:"center",padding:"0 3px",cursor:"pointer",justifyContent:"flex-end" }}>
                  <div style={{ width:14,height:14,borderRadius:"50%",background:"#fff" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ONBOARDING ───────────────────────────────────────────────────────────────
const ONBOARDING_SLIDES = [
  {
    kicker: "Collection",
    title: "Build your vault",
    body: "Catalog figures with photos, condition, and value. Keep inventory, sale, and trade listings in one place.",
    cta: "Continue",
  },
  {
    kicker: "Matching",
    title: "Trade with better fit",
    body: "Review collector listings by line, value, and wishlist overlap before you propose a trade.",
    cta: "Continue",
  },
  {
    kicker: "Protection",
    title: "Escrow-backed deals",
    body: "Purchases stay in escrow until delivery is confirmed. Disputes pause release when something goes wrong.",
    cta: "Continue",
  },
  {
    kicker: "Alerts",
    title: "Catch listings early",
    body: "Wishlist tags surface new matches as soon as relevant figures are listed.",
    cta: "Enter marketplace",
    last: true,
  },
];

function OnboardingScreen({ onComplete }) {
  const [slide, setSlide] = useState(0);
  const s = ONBOARDING_SLIDES[slide];

  return (
    <div className="inhand-onboarding">
      <div style={{ padding:"20px 24px 0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div className="inhand-brand-logo" style={{ width:40, height:40 }}>
          <img src={LOGO_IMG} alt="In Hand" />
        </div>
        <button type="button" onClick={onComplete} className="inhand-onboarding-cta" style={{ width:"auto", padding:"8px 14px", fontSize:12 }}>Skip</button>
      </div>

      <div key={slide} className="inhand-onboarding-body">
        <p className="inhand-onboarding-kicker">{s.kicker}</p>
        <h1 className="inhand-onboarding-title">{s.title}</h1>
        <p className="inhand-onboarding-copy">{s.body}</p>
      </div>

      <div className="inhand-onboarding-footer">
        <div className="inhand-onboarding-dots">
          {ONBOARDING_SLIDES.map((_, i) => (
            <button key={i} type="button" onClick={() => setSlide(i)} data-active={i === slide ? "true" : "false"} aria-label={`Go to slide ${i + 1}`} />
          ))}
        </div>
        <button type="button" className="inhand-onboarding-cta" onClick={() => (s.last ? onComplete() : setSlide((i) => i + 1))}>
          {s.cta}
        </button>
      </div>
    </div>
  );
}

export default function InHand() {
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(!!supabase);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryPw, setRecoveryPw] = useState({ a: "", b: "" });
  const [recoveryErr, setRecoveryErr] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !supabase) return undefined;
    const syncRecovery = () => setRecoveryOpen(window.location.hash.includes("type=recovery"));
    const completeAuthFromUrl = async () => {
      const href = window.location.href;
      const listingId = parseListingIdFromUrl(window.location.pathname);
      if (listingId) {
        try {
          sessionStorage.setItem("inhand-pending-listing", listingId);
        } catch {
          /* ignore */
        }
        if (!Capacitor.isNativePlatform()) {
          tryOpenListingInApp(listingId);
        }
      }
      if (href.includes("access_token=") || href.includes("code=") || href.includes("/auth/callback")) {
        const ok = await handleSupabaseAuthDeepLink(href, supabase);
        if (ok && !window.location.hash.includes("type=recovery")) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }
      syncRecovery();
    };
    completeAuthFromUrl();
    window.addEventListener("hashchange", syncRecovery);
    return () => window.removeEventListener("hashchange", syncRecovery);
  }, []);

  useEffect(() => {
    async function init() {
      try { const r = await window.storage.get("inhand-onboarded"); if (r) setOnboardingDone(true); } catch {}
    }
    init();
  }, []);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return undefined;
    }

    let cancelled = false;

    // Single path for session + profile: onAuthStateChange runs immediately with current session.
    // Avoid a parallel loadSessionProfile() IIFE — React Strict Mode cleanup could set cancelled
    // before that IIFE’s finally ran, leaving authLoading true forever ("Loading your account…").
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) {
        if (!cancelled) setAuthUser(null);
        setAuthLoading(false);
        return;
      }
      try {
        const profile = await ensureUserProfile(session.user);
        if (!cancelled) setAuthUser(profile);
      } catch (err) {
        console.error("In Hand: profile sync failed", err);
      } finally {
        setAuthLoading(false);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const completeOnboarding = async () => {
    setOnboardingDone(true);
    try { await window.storage.set("inhand-onboarded","1"); } catch {}
  };

  const handleSignOut = async () => {
    setAuthUser(null);
    if (supabase) {
      try { await supabase.auth.signOut(); } catch {}
    }
  };

  const submitRecoveryPassword = async () => {
    if (!supabase) return;
    setRecoveryErr("");
    if ((recoveryPw.a || "").length < 8) {
      setRecoveryErr("Password must be at least 8 characters.");
      return;
    }
    if (recoveryPw.a !== recoveryPw.b) {
      setRecoveryErr("Passwords do not match.");
      return;
    }
    setRecoveryBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: recoveryPw.a });
      if (error) throw error;
      window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
      setRecoveryOpen(false);
      setRecoveryPw({ a: "", b: "" });
    } catch (e) {
      setRecoveryErr(e?.message || "Could not update password.");
    } finally {
      setRecoveryBusy(false);
    }
  };

  if (!onboardingDone) return <OnboardingScreen onComplete={completeOnboarding} />;
  if (authLoading) return <div className="inhand-loading">Loading your account...</div>;
  if (!supabase) {
    return (
      <div className="inhand-config-required">
        <div>
          <h1>Configuration required</h1>
          <p>Add your Supabase URL and anon key in the deployment environment before using In Hand.</p>
        </div>
      </div>
    );
  }
  if (recoveryOpen) {
    return (
      <div style={{ minHeight: "100vh", background: "#EEF2F7", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "'Poppins',sans-serif" }}>
        <div style={{ background: "#fff", borderRadius: 20, padding: 28, maxWidth: 400, width: "100%", boxShadow: "0 8px 40px rgba(0,0,0,0.08)" }}>
          <div style={{ fontWeight: 800, fontSize: 20, color: "#2C3E50", marginBottom: 8 }}>Set new password</div>
          <div style={{ fontSize: 13, color: "#aaa", marginBottom: 20 }}>You opened a password recovery link. Choose a new password, then sign in as usual.</div>
          <input type="password" placeholder="New password" value={recoveryPw.a} onChange={(e) => setRecoveryPw((p) => ({ ...p, a: e.target.value }))} style={{ ...IS_AUTH, marginBottom: 10 }} />
          <input type="password" placeholder="Confirm password" value={recoveryPw.b} onChange={(e) => setRecoveryPw((p) => ({ ...p, b: e.target.value }))} style={{ ...IS_AUTH, marginBottom: 12 }} />
          {recoveryErr && <div style={{ color: "#ff6b6b", fontSize: 12, fontWeight: 600, marginBottom: 12 }}>{recoveryErr}</div>}
          <button type="button" disabled={recoveryBusy} onClick={submitRecoveryPassword} style={{ width: "100%", background: "#2C3E50", border: "none", borderRadius: 14, padding: "14px", color: "#fff", fontWeight: 800, fontSize: 15, cursor: "pointer" }}>
            {recoveryBusy ? "Saving…" : "Update password"}
          </button>
        </div>
      </div>
    );
  }
  if (!authUser) return <AuthScreen onAuth={setAuthUser} />;
  return <AppShell onSignOut={handleSignOut} authUser={authUser} />;
}

function AppShell({ onSignOut, authUser }) {
  const activeUserId = authUser?.id || DEFAULT_USER_ID;
  const [db, setDb] = useState(() => (supabase ? EMPTY_DB : { users:SEED_USERS, cards:SEED_CARDS, transactions:SEED_TRANSACTIONS, shipments:SEED_SHIPMENTS, disputes:SEED_DISPUTES, ratings:SEED_RATINGS, messages:SEED_MESSAGES, notifications:SEED_NOTIFICATIONS }));
  const dbRef = useRef(db);
  useEffect(() => {
    dbRef.current = db;
  }, [db]);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [tab, setTab] = useState("browse");
  useEffect(() => {
    const onNavigate = (e) => {
      const next = e?.detail?.tab;
      if (next && NAV_ITEMS.some(([id]) => id === next)) setTab(next);
    };
    window.addEventListener("inhand:navigate", onNavigate);
    return () => window.removeEventListener("inhand:navigate", onNavigate);
  }, []);
  const [viewMode, setViewMode] = useState("list");
  const [search, setSearch] = useState("");
  const [lineFilter, setLineFilter] = useState("All");
  const [brandFilter, setBrandFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortBy, setSortBy] = useState("match");
  const [swipeCards, setSwipeCards] = useState([]);
  const [liked, setLiked] = useState([]);
  const [toast, setToast] = useState(null);
  const [selectedOffer, setSelectedOffer] = useState(null);
  const [showAddCard, setShowAddCard] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [checkoutCard, setCheckoutCard] = useState(null);
  const [sweetenerTrade, setSweetenerTrade] = useState(null);
  const [trackingModal, setTrackingModal] = useState(null);
  const [addTrackingFor, setAddTrackingFor] = useState(null);
  const [marketModal, setMarketModal] = useState(null);
  const [showAddressModal, setShowAddressModal] = useState(false);
  const [disputeModal, setDisputeModal] = useState(null);
  const [ratingModal, setRatingModal] = useState(null);
  const [activeThread, setActiveThread] = useState(null);
  const [adminView, setAdminView] = useState("users");
  const [photoViewer, setPhotoViewer] = useState(null);
  const [listingVideoModal, setListingVideoModal] = useState(null);
  const [vaultVideoDraft, setVaultVideoDraft] = useState("");
  const [editingPhotos, setEditingPhotos] = useState(null);
  const [shareCard, setShareCard] = useState(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [editProfileTab, setEditProfileTab] = useState("profile");
  const ratingsSectionRef = useRef(null);
  const [showPackagingGuide, setShowPackagingGuide] = useState(false);
  const [vaultFilter, setVaultFilter] = useState("all");
  const [tradesView, setTradesView] = useState("proposed");

  const myNotifications = (db.notifications||[]);
  const unreadNotifCount = myNotifications.filter(n=>!n.read).length;

  const markAllRead = async () => {
    if (supabase) {
      const { error } = await markAllNotificationsRead(activeUserId);
      if (error) console.error("In Hand: mark all notifications failed", error);
    }
    setDb((d) => ({ ...d, notifications: d.notifications.map((n) => ({ ...n, read: true })) }));
  };
  const markRead = async (id) => {
    if (supabase) {
      const { error } = await markNotificationRead(id);
      if (error) console.error("In Hand: mark notification read failed", error);
    }
    setDb((d) => ({
      ...d,
      notifications: d.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
    }));
  };

  // Wishlist match — persist for other collectors (Supabase); local row if recipient is you
  const checkWishlistMatch = async (newCard) => {
    if (!supabase) return;
    for (const u of db.users) {
      if (u.id === newCard.ownerId) continue;
      const hits = (u.wishlist || []).filter(
        (tag) => newCard.tags?.includes(tag) || newCard.line === tag
      );
      if (!hits.length) continue;
      const nid = `n${Date.now()}_${u.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
      const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
      const row = {
        id: nid,
        recipientId: u.id,
        type: "wishlist_match",
        read: false,
        title: "Wishlist match! 🔥",
        body: `${newCard.name} just listed — matches your wishlist`,
        cardId: newCard.id,
        link: "browse",
        relatedUserId: newCard.ownerId,
      };
      const { error } = await insertNotification(row);
      if (error) {
        console.error("In Hand: wishlist notification insert failed", error);
        continue;
      }
      if (u.id === activeUserId) {
        setDb((d) => ({
          ...d,
          notifications: [
            {
              id: nid,
              type: "wishlist_match",
              read: false,
              ts,
              title: row.title,
              body: row.body,
              cardId: newCard.id,
              link: "browse",
              userId: newCard.ownerId,
            },
            ...(d.notifications || []),
          ],
        }));
      }
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (supabase) {
        try {
          const userId = authUser?.id || activeUserId;
          const fromCloud = await fetchAppDatabaseShape(supabase, userId);
          let users = fromCloud.users || [];
          if (authUser?.id && !users.some((u) => u.id === authUser.id)) {
            const { data: row } = await supabase
              .from("users")
              .select("*")
              .eq("id", authUser.id)
              .maybeSingle();
            if (row) users = [...users, userFromRow(row)];
          }
          if (!cancelled) setDb({
            users,
            cards: fromCloud.cards || [],
            transactions: fromCloud.transactions || [],
            shipments: fromCloud.shipments || [],
            disputes: fromCloud.disputes || [],
            ratings: fromCloud.ratings || [],
            messages: fromCloud.messages || [],
            notifications: fromCloud.notifications || [],
          });
        } catch (e) {
          console.error("In Hand: Supabase load failed (check RLS policies and seed).", e);
          if (!cancelled) {
            setDb(EMPTY_DB);
          }
        }
      } else {
        try {
          const r = await window.storage.get("inhand-db-v2");
          if (r) setDb(JSON.parse(r.value));
        } catch {}
      }
      if (!cancelled) setDbLoaded(true);
    }
    load();
    return () => { cancelled = true; };
  }, [authUser?.id]);

  // After Stripe Checkout success redirect, resync DB from Supabase (webhook writes order).
  useEffect(() => {
    if (!supabase || !dbLoaded) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success") return;
    let cancelled = false;
    (async () => {
      try {
        const userId = authUser?.id || activeUserId;
        const fromCloud = await fetchAppDatabaseShape(supabase, userId);
        if (cancelled) return;
        setDb({
          users: fromCloud.users || [],
          cards: fromCloud.cards || [],
          transactions: fromCloud.transactions || [],
          shipments: fromCloud.shipments || [],
          disputes: fromCloud.disputes || [],
          ratings: fromCloud.ratings || [],
          messages: fromCloud.messages || [],
          notifications: fromCloud.notifications || [],
        });
        notify("✅ Payment complete — your order is synced.");
      } catch (e) {
        console.error("In Hand: post-checkout resync failed", e);
        notify("⚠️ Payment may have succeeded — refresh if you don’t see your order.");
      } finally {
        window.history.replaceState({}, "", window.location.pathname);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dbLoaded, authUser?.id]);

  useEffect(() => {
    if (!dbLoaded || supabase) return;
    async function save() { try { await window.storage.set("inhand-db-v2", JSON.stringify(db)); } catch {} }
    save();
  }, [db, dbLoaded]);

  const getUser = id => db.users.find(u=>u.id===id);
  const myUser = getUser(activeUserId);
  const myCards = db.cards.filter(c=>c.ownerId===activeUserId);
  const myTradeable = myCards.filter(c=>c.wantsTrade);
  const otherCards = db.cards.filter(c=>c.ownerId!==activeUserId);
  const myTxns = db.transactions.filter(t=>t.buyerId===activeUserId||t.sellerId===activeUserId);
  const myTradeTxns = myTxns.filter(t => t.type === "trade" || t.type === "sweetener");
  const vaultFiltered = myCards.filter((c) => {
    if (vaultFilter === "trade") return c.wantsTrade;
    if (vaultFilter === "sale") return c.wantsBuy;
    if (vaultFilter === "private") return !c.wantsTrade && !c.wantsBuy;
    return true;
  });

  useEffect(() => {
    if (!editingPhotos) {
      setVaultVideoDraft("");
      return;
    }
    const fig = db.cards.find((c) => c.id === editingPhotos && c.ownerId === activeUserId);
    setVaultVideoDraft(fig?.videoUrl || "");
  }, [editingPhotos, db.cards, activeUserId]);

  useEffect(() => { if(myTradeable.length&&!selectedOffer) setSelectedOffer(myTradeable[0]); }, [myTradeable.length]);
  const notify = msg => { setToast(stripToastEmoji(msg)); setTimeout(()=>setToast(null),2500); };

  const openListingById = (listingId) => {
    const card = db.cards.find((c) => c.id === listingId);
    if (!card) {
      notify("Listing not found or no longer available.");
      return;
    }
    setTab("browse");
    if (card.wantsBuy) setCheckoutCard(card);
    else setMarketModal(card);
  };

  useEffect(() => {
    const onOpenListing = (e) => {
      const id = e?.detail?.listingId;
      if (id) openListingById(id);
    };
    window.addEventListener("inhand:open-listing", onOpenListing);
    return () => window.removeEventListener("inhand:open-listing", onOpenListing);
  }, [db.cards]);

  useEffect(() => {
    if (!dbLoaded) return;
    let listingId =
      parseListingIdFromUrl(window.location.pathname) ||
      parseListingIdFromUrl(window.location.href);
    if (!listingId && typeof sessionStorage !== "undefined") {
      listingId = sessionStorage.getItem("inhand-pending-listing");
      if (listingId) sessionStorage.removeItem("inhand-pending-listing");
    }
    if (!listingId) return;
    openListingById(listingId);
    window.history.replaceState({}, document.title, "/");
  }, [dbLoaded, db.cards]);

  const openEditProfile = (tabId = "profile") => {
    setEditProfileTab(tabId);
    setShowEditProfile(true);
  };

  const handleExportMyData = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      user: myUser,
      listings: myCards,
      transactions: myTxns,
      shipments: (db.shipments || []).filter((s) => s.fromUser === activeUserId || s.toUser === activeUserId),
      ratings: (db.ratings || []).filter((r) => r.fromUserId === activeUserId || r.toUserId === activeUserId),
      disputes: (db.disputes || []).filter((d) => d.raisedBy === activeUserId || d.againstUserId === activeUserId),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `in-hand-export-${activeUserId}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify("📥 Data export downloaded");
  };

  const handleDeactivateAccount = async () => {
    for (const card of myCards) {
      if (supabase) await deleteListing(card.id);
    }
    setDb((d) => ({
      ...d,
      cards: d.cards.filter((c) => c.ownerId !== activeUserId),
    }));
    notify("Account deactivated — your listings are hidden");
  };

  const handleDeleteAccount = async () => {
    await handleDeactivateAccount();
    notify("Account deletion requested — signing out");
    onSignOut();
  };

  const handleAdminToggleVerified = async (userId, verified) => {
    if (supabase) {
      const { error } = await supabase.from("users").update({ verified }).eq("id", userId);
      if (error) {
        console.error("In Hand: verified toggle failed", error);
        notify("❌ Could not update verified badge");
        return;
      }
    }
    setDb((d) => ({
      ...d,
      users: d.users.map((u) => (u.id === userId ? { ...u, verified } : u)),
    }));
    notify(verified ? "✓ Seller verified" : "Verified badge removed");
  };

  const handleAdminResolveDispute = async (d, kind) => {
    const resolvedAt = new Date().toISOString().split("T")[0];
    const configs = {
      usps_claim: {
        resolution: "usps_claim",
        adminNote: "USPS insurance claim initiated. Buyer keeps item. Seller files claim at usps.com/help/claims.htm.",
        txnStatus: "completed",
        releaseFunds: true,
        disputeFrozen: false,
      },
      refund_full: {
        resolution: "refund_full",
        adminNote: "Full refund issued by admin.",
        txnStatus: "refunded",
        releaseFunds: false,
        disputeFrozen: false,
      },
      no_action: {
        resolution: "no_action",
        adminNote: "Dispute rejected — funds released to seller.",
        txnStatus: "completed",
        releaseFunds: true,
        disputeFrozen: false,
      },
    };
    const cfg = configs[kind];
    if (!cfg) return;

    if (supabase) {
      const { error: dErr } = await updateDisputeById(d.id, {
        status: "resolved",
        resolution: cfg.resolution,
        adminNote: cfg.adminNote,
        resolvedAt,
      });
      if (dErr) {
        console.error("In Hand: dispute resolve failed", dErr);
        notify("❌ Could not save dispute resolution");
        return;
      }
      const { error: tErr } = await updateTransaction(d.txnId, { status: cfg.txnStatus });
      if (tErr) console.error("In Hand: txn update on dispute resolve", tErr);
      if (d.shipmentId) {
        await updateShipmentById(d.shipmentId, {
          disputeFrozen: cfg.disputeFrozen,
          fundsReleased: cfg.releaseFunds,
        });
        if (cfg.releaseFunds && d.disputeType !== "trade") {
          await tryReleaseEscrow(d.shipmentId, false);
        }
      }
    }

    setDb((db) => ({
      ...db,
      disputes: db.disputes.map((x) =>
        x.id === d.id
          ? { ...x, status: "resolved", resolution: cfg.resolution, resolvedAt, adminNote: cfg.adminNote }
          : x
      ),
      transactions: db.transactions.map((t) =>
        t.id === d.txnId ? { ...t, status: cfg.txnStatus } : t
      ),
      shipments: d.shipmentId
        ? db.shipments.map((s) =>
            s.id === d.shipmentId
              ? { ...s, disputeFrozen: cfg.disputeFrozen, fundsReleased: cfg.releaseFunds || s.fundsReleased }
              : s
          )
        : db.shipments,
    }));

    const msgs = {
      usps_claim: "📮 USPS claim resolution applied",
      refund_full: "✅ Dispute resolved — full refund issued",
      no_action: "Dispute closed — funds released to seller",
    };
    notify(msgs[kind]);
  };

  const reloadFromSupabase = async () => {
    if (!supabase) return;
    try {
      const userId = authUser?.id || activeUserId;
      const fromCloud = await fetchAppDatabaseShape(supabase, userId);
      setDb({
        users: fromCloud.users || [],
        cards: fromCloud.cards || [],
        transactions: fromCloud.transactions || [],
        shipments: fromCloud.shipments || [],
        disputes: fromCloud.disputes || [],
        ratings: fromCloud.ratings || [],
        messages: fromCloud.messages || [],
        notifications: fromCloud.notifications || [],
      });
      notify("🔄 Reloaded from Supabase");
    } catch (e) {
      console.error("In Hand: Supabase reload failed", e);
      notify("❌ Could not reload from Supabase");
    }
  };

  const enriched = otherCards.map(c=>({ ...c, owner:getUser(c.ownerId), matchScore:computeMatch(myCards,c,myUser?.wishlist||[]) }));
  const filtered = enriched.filter(c=>{
    const q=search.toLowerCase();
    return (!q||c.name.toLowerCase().includes(q)||c.line.toLowerCase().includes(q)||c.tags.some(t=>t.includes(q))||c.owner?.username.toLowerCase().includes(q))
      && (brandFilter==="All"||c.brand===brandFilter)
      && (lineFilter==="All"||c.line===lineFilter)
      && (typeFilter==="all"||(typeFilter==="trade"&&c.wantsTrade)||(typeFilter==="buy"&&c.wantsBuy));
  }).sort((a,b)=>sortBy==="match"?b.matchScore-a.matchScore:b.value-a.value);

  const handleSwipe = (dir,cardId) => { const c=enriched.find(x=>x.id===cardId); if(dir==="yes"&&c){setLiked(l=>[...l,c]);notify("🤝 Trade proposed!");} setSwipeCards(p=>p.filter(id=>id!==cardId)); };
  const launchSwipe = list => { setSwipeCards(list.map(c=>c.id).reverse()); setTab("swipe"); };

  const handleAddUser = async (user) => {
    if (supabase) {
      const row = {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        rating: user.rating ?? 5,
        trades_completed: user.tradesCompleted ?? 0,
        joined: user.joined,
        location: user.location || "",
        wishlist: user.wishlist || [],
        wallet_balance: user.walletBalance ?? 0,
        payment_methods: user.paymentMethods || [],
        addresses: user.addresses || [],
        flag_count: 0,
        verified: !!user.verified,
      };
      const { error } = await supabase.from("users").insert(row);
      if (error) {
        console.error("In Hand: create user failed", error);
        notify("❌ Could not create user in Supabase");
        return;
      }
    }
    setDb((d) => ({ ...d, users: [...d.users, user] }));
    notify("✅ User created");
  };

  const handleAdminDeleteUser = async (userId) => {
    if (userId === activeUserId) {
      notify("Cannot delete your own account here — use Account → Privacy");
      return;
    }
    if (!window.confirm("Delete this user and their listings from the app database?")) return;
    if (supabase) {
      await supabase.from("users").delete().eq("id", userId);
    }
    setDb((d) => ({
      ...d,
      users: d.users.filter((u) => u.id !== userId),
      cards: d.cards.filter((c) => c.ownerId !== userId),
      transactions: d.transactions.filter((t) => t.buyerId !== userId && t.sellerId !== userId),
    }));
    notify("User removed");
  };

  const handleAddCard = async (card) => {
    if (supabase) {
      const { error } = await createListing(card);
      if (error) {
        console.error("In Hand: create listing failed", error);
        notify("❌ Could not save figure to Supabase");
        return;
      }
    }
    setDb(d=>({...d,cards:[...d.cards,card]}));
    checkWishlistMatch(card);
    notify("✅ Figure added!");
  };

  const handleDeleteCard = async (cardId) => {
    if (supabase) {
      const { error } = await deleteListing(cardId);
      if (error) {
        console.error("In Hand: delete listing failed", error);
        notify("❌ Could not delete figure in Supabase");
        return;
      }
    }
    setDb(d=>({...d,cards:d.cards.filter(c=>c.id!==cardId)}));
    notify("🗑️ Figure removed");
  };

  const handleSaveCardPhotos = async (cardId, photos) => {
    if (supabase) {
      const { error } = await updateListing(cardId, { photos });
      if (error) {
        console.error("In Hand: update listing photos failed", error);
        notify("❌ Could not save photos to Supabase");
        return;
      }
    }
    setDb((d) => ({
      ...d,
      cards: d.cards.map((c) => (c.id === cardId ? { ...c, photos } : c)),
    }));
    notify("📷 Photos saved!");
    setEditingPhotos(null);
  };

  const handleSaveListingVideo = async (cardId) => {
    const trimmed = (vaultVideoDraft || "").trim();
    if (supabase) {
      const { error } = await updateListing(cardId, { videoUrl: trimmed || null });
      if (error) {
        console.error("In Hand: listing video URL save failed", error);
        notify("❌ Could not save video link to Supabase");
        return;
      }
    }
    setDb((d) => ({
      ...d,
      cards: d.cards.map((c) => (c.id === cardId ? { ...c, videoUrl: trimmed } : c)),
    }));
    notify(trimmed ? "🎬 Video link saved" : "Video link cleared");
  };

  const handleToggleListing = async (cardId, field) => {
    const card = db.cards.find((c) => c.id === cardId);
    if (!card) return;
    const nextVal = !card[field];
    if (supabase) {
      const { error } = await updateListing(cardId, { [field]: nextVal });
      if (error) {
        console.error("In Hand: listing toggle failed", error);
        notify("❌ Could not update listing");
        return;
      }
    }
    setDb((d) => ({
      ...d,
      cards: d.cards.map((c) => (c.id === cardId ? { ...c, [field]: nextVal } : c)),
    }));
    notify(nextVal ? (field === "wantsTrade" ? "Listed for trade" : "Listed for sale") : (field === "wantsTrade" ? "Removed from trade listings" : "Removed from sale listings"));
  };

  const handlePurchaseWithCard = async (card) => {
    setCheckoutCard(null);
    try {
      await startStripeCheckout({
        listingId: card.id,
        buyerId: activeUserId,
        successUrl: `${window.location.origin}?checkout=success`,
        cancelUrl: `${window.location.origin}?checkout=cancelled`,
      });
    } catch (err) {
      console.error("In Hand: Stripe checkout start failed", err);
      notify("❌ Could not start Stripe checkout. Deploy Edge Function + set secrets.");
      setCheckoutCard(card);
    }
  };

  const handleReleaseFunds = async (shipment) => {
    const txn = db.transactions.find(t=>t.id===shipment.txnId);
    if(!txn) return;
    if (supabase) {
      const { data, error } = await tryReleaseEscrow(shipment.id, false);
      if (error || !data?.ok) {
        console.error("In Hand: escrow release RPC failed", error || data);
        notify(data?.error ? `❌ ${data.error}` : "❌ Could not release funds in Supabase");
        return;
      }
    }
    setDb(d=>({
      ...d,
      users: d.users.map(u => {
        if(u.id===shipment.fromUser) return {...u, walletBalance:parseFloat((u.walletBalance+txn.net).toFixed(2))};
        return u;
      }),
      transactions: d.transactions.map(t=>t.id===txn.id?{...t,status:"completed"}:t),
      shipments: d.shipments.map(s=>s.id===shipment.id?{...s,fundsReleased:true}:s),
    }));
    notify("✅ Funds released to seller!");
  };

  const handleAddTracking = async (txnId, trackingNumber) => {
    const simEvents = [
      { date: new Date().toISOString().slice(0,16).replace("T"," "), location:"Origin", description:"Shipping label created" },
    ];
    if (supabase) {
      const { error } = await updateShipmentByTxnId(txnId, {
        trackingNumber,
        status: "accepted",
        events: simEvents,
      });
      if (error) {
        console.error("In Hand: add tracking failed", error);
        notify("❌ Could not save tracking in Supabase");
        return;
      }
    }
    setDb(d=>({...d, shipments:d.shipments.map(s=>s.txnId===txnId?{...s, trackingNumber, status:"accepted", events:simEvents}:s)}));
    setAddTrackingFor(null);
    notify("📦 Tracking number added!");
  };

  const simulateDelivery = async (shipmentId) => {
    const deliveredAt = new Date().toISOString();
    const target = db.shipments.find(s => s.id === shipmentId);
    if (supabase && target) {
      const nextEvents = [...(target.events||[]), { date:deliveredAt.slice(0,16).replace("T"," "), location:"Destination", description:"Delivered — Front Door" }];
      const { error } = await updateShipmentById(shipmentId, {
        status: "delivered",
        deliveredAt,
        events: nextEvents,
      });
      if (error) {
        console.error("In Hand: delivery simulation update failed", error);
        notify("❌ Could not mark delivered in Supabase");
        return;
      }
    }
    setDb(d=>({...d, shipments:d.shipments.map(s=>{
      if(s.id!==shipmentId) return s;
      const events=[...s.events,{ date:deliveredAt.slice(0,16).replace("T"," "), location:"Destination", description:"Delivered — Front Door" }];
      return {...s, status:"delivered", deliveredAt, events};
    })}));
    notify("📬 Package delivered! Funds auto-release in 7 days.");
  };

  // ── AUTO-RELEASE: 7d after delivery, credit seller in UI + persist txn/shipment to Supabase ──
  useEffect(() => {
    if (!dbLoaded) return;

    const runAutoRelease = async () => {
      const d = dbRef.current;
      const now = Date.now();
      const toRelease = (d.shipments || []).filter((s) => {
        if (s.status !== "delivered" || s.fundsReleased || !s.deliveredAt || s.disputeFrozen) return false;
        const hoursElapsed = (now - new Date(s.deliveredAt).getTime()) / (1000 * 60 * 60);
        return hoursElapsed >= 168;
      });
      if (toRelease.length === 0) return;

      if (supabase) {
        for (const s of toRelease) {
          const { data, error } = await tryReleaseEscrow(s.id, true);
          if (error || !data?.ok) {
            console.error("In Hand: auto-release RPC failed", s.id, error || data);
          }
        }
      }

      setDb((prev) => {
        const now2 = Date.now();
        let changed = false;
        const newShipments = (prev.shipments || []).map((s) => {
          if (s.status === "delivered" && !s.fundsReleased && s.deliveredAt) {
            const deliveredMs = new Date(s.deliveredAt).getTime();
            const hoursElapsed = (now2 - deliveredMs) / (1000 * 60 * 60);
            if (hoursElapsed >= 168) {
              changed = true;
              return { ...s, fundsReleased: true, autoReleased: true };
            }
          }
          return s;
        });
        if (!changed) return prev;
        const releasedShipments = newShipments.filter(
          (s) => s.autoReleased && !prev.shipments.find((os) => os.id === s.id)?.autoReleased
        );
        const newUsers = prev.users.map((u) => {
          const earned = releasedShipments
            .filter((s) => s.fromUser === u.id)
            .reduce((sum, s) => {
              const txn = prev.transactions.find((t) => t.id === s.txnId);
              return sum + (txn ? txn.net : 0);
            }, 0);
          if (earned > 0) return { ...u, walletBalance: parseFloat((u.walletBalance + earned).toFixed(2)) };
          return u;
        });
        const newTxns = prev.transactions.map((t) => {
          const released = releasedShipments.find((s) => s.txnId === t.id);
          return released ? { ...t, status: "completed" } : t;
        });
        return { ...prev, shipments: newShipments, users: newUsers, transactions: newTxns };
      });
    };

    runAutoRelease();
    const interval = setInterval(runAutoRelease, 60000);
    return () => clearInterval(interval);
  }, [dbLoaded]);

  const handleSweetenerConfirm = async ({ sweetener, fee, total, payMethod }) => {
    if (!sweetenerTrade) return;
    const { theirCard, myFigure } = sweetenerTrade;
    const iOwe = theirCard.value > myFigure.value;
    const sweetenerFee = sweetener > 0 ? parseFloat((sweetener * PLATFORM_FEE).toFixed(2)) : 0;
    const txns = [];
    // Log sweetener payment if there's a difference
    if (sweetener > 0 && iOwe) {
      txns.push({ id:"t"+Date.now()+"s", type:"sweetener", buyerId:activeUserId, sellerId:theirCard.ownerId, cardId:theirCard.id, amount:sweetener, fee, net:sweetener-fee, status:"completed", method:payMethod, date:new Date().toISOString().split("T")[0], cardName:`Sweetener: ${myFigure.name} ⇄ ${theirCard.name}` });
    }
    // Log the trade itself with $2 fee per party
    txns.push({ id:"t"+Date.now()+"t", type:"trade", buyerId:activeUserId, sellerId:theirCard.ownerId, cardId:theirCard.id, amount:0, fee:TRADE_FEE, net:0, status:"completed", method:"trade", date:new Date().toISOString().split("T")[0], cardName:`Trade: ${myFigure.name} ⇄ ${theirCard.name}` });
    if (supabase) {
      for (const t of txns) {
        const { error: txnErr } = await upsertTransaction(t);
        if (txnErr) {
          console.error("In Hand: trade transaction write failed", txnErr);
          notify("❌ Trade failed: could not save transaction");
          return;
        }
      }
      const { error } = await swapTradeListings(theirCard.id, myFigure.id);
      if (error) {
        console.error("In Hand: trade ownership transfer failed", error);
        notify("❌ Trade failed: could not swap figures in Supabase");
        return;
      }
      let nextSelfWallet = null;
      if (myUser) {
        if (iOwe && payMethod === "wallet") nextSelfWallet = parseFloat((myUser.walletBalance - total).toFixed(2));
        else if (!iOwe) nextSelfWallet = parseFloat((myUser.walletBalance - TRADE_FEE).toFixed(2));
      }
      if (nextSelfWallet != null) {
        const { error: wErr } = await updateOwnUser(activeUserId, { walletBalance: nextSelfWallet });
        if (wErr) {
          console.error("In Hand: trade wallet update failed", wErr);
          notify("⚠️ Trade saved; your wallet in Supabase may be out of sync — refresh");
        }
      }
    }

    setDb(d => {
      const newUsers = d.users.map(u => {
        // Deduct sweetener from buyer's wallet if wallet used
        if(u.id===activeUserId && iOwe && payMethod==="wallet") return {...u, walletBalance:parseFloat((u.walletBalance-total).toFixed(2))};
        // Deduct $2 trade fee from both parties
        if(u.id===activeUserId && !iOwe) return {...u, walletBalance:parseFloat((u.walletBalance-TRADE_FEE).toFixed(2))};
        // Credit seller net sweetener minus their $2 fee
        if(u.id===theirCard.ownerId && iOwe) return {...u, walletBalance:parseFloat((u.walletBalance+(sweetener-sweetenerFee-TRADE_FEE)).toFixed(2))};
        if(u.id===theirCard.ownerId && !iOwe) return {...u, walletBalance:parseFloat((u.walletBalance-TRADE_FEE).toFixed(2))};
        return u;
      });
      // Swap ownership of both figures
      const newCards = d.cards.map(c => {
        if(c.id===theirCard.id) return {...c, ownerId:activeUserId, wantsTrade:false, wantsBuy:false};
        if(c.id===myFigure.id) return {...c, ownerId:theirCard.ownerId, wantsTrade:false, wantsBuy:false};
        return c;
      });
      return { ...d, users:newUsers, cards:newCards, transactions:[...txns,...d.transactions] };
    });
    setSweetenerTrade(null);
    setLiked(l => l.filter(c => c.id !== theirCard.id));
  };

  // ── MESSAGING ──
  const myThreads = (db.messages||[]).filter(th => th.participants.includes(activeUserId));
  const unreadCount = myThreads.reduce((n, th) => {
    const last = th.messages[th.messages.length - 1];
    return last && last.from !== activeUserId ? n + 1 : n;
  }, 0);

  const openThread = (otherUserId, card) => {
    const existing = (db.messages||[]).find(th =>
      th.participants.includes(activeUserId) &&
      th.participants.includes(otherUserId) &&
      th.cardId === card?.id
    );
    if (existing) { setActiveThread(existing.id); setTab("messages"); return; }
    // Create new thread
    const newThread = {
      id: "th" + Date.now(),
      participants: [activeUserId, otherUserId],
      cardId: card?.id || null,
      cardName: card?.name || null,
      cardImage: card?.image || null,
      messages: [],
    };
    (async () => {
      if (supabase) {
        const { error } = await insertConversation(newThread);
        if (error) {
          console.error("In Hand: conversation creation failed", error);
          notify("❌ Could not start conversation");
          return;
        }
      }
      setDb(d => ({ ...d, messages: [...(d.messages||[]), newThread] }));
      setActiveThread(newThread.id);
      setTab("messages");
    })();
  };

  const sendMessage = async (threadId, text) => {
    if (!text.trim()) return;
    const msg = { id:"m"+Date.now(), from:activeUserId, text:text.trim(), ts:new Date().toISOString().slice(0,16).replace("T"," ") };
    if (supabase) {
      const { error } = await insertChatMessage(threadId, msg);
      if (error) {
        console.error("In Hand: chat message insert failed", error);
        notify("❌ Message failed to send");
        return;
      }
    }
    setDb(d => ({ ...d, messages:(d.messages||[]).map(th => th.id===threadId ? {...th, messages:[...th.messages, msg]} : th) }));
  };

  const flagMessage = async (threadId, text, label) => {
    const thread = (db.messages||[]).find(th => th.id === threadId);
    const nextFlags = [...(thread?.flags||[]), { text, label, by:activeUserId, ts:new Date().toISOString() }];
    const nextFlagCount = (thread?.flagCount||0) + 1;
    if (supabase) {
      const { error } = await updateConversationFlags(threadId, nextFlags, nextFlagCount);
      if (error) {
        console.error("In Hand: message flag update failed", error);
        notify("❌ Could not flag message in Supabase");
        return;
      }
      const { error: uErr } = await updateOwnUser(activeUserId, { flagCount: (myUser?.flagCount || 0) + 1 });
      if (uErr) {
        console.error("In Hand: user flag count update failed", uErr);
        notify("⚠️ Thread flagged; profile flag count may be out of sync");
      }
    }
    setDb(d => ({
      ...d,
      messages: (d.messages||[]).map(th => th.id===threadId ? {...th, flagCount:(th.flagCount||0)+1, flags:[...(th.flags||[]),{ text, label, by:activeUserId, ts:new Date().toISOString() }]} : th),
      users: d.users.map(u => u.id===activeUserId ? {...u, flagCount:(u.flagCount||0)+1} : u),
    }));
    notify(`🚫 Message blocked — ${label} not allowed`);
  };

  const handleSaveAddresses = async (newAddresses) => {
    if (supabase) {
      const { error } = await updateOwnUser(activeUserId, { addresses: newAddresses });
      if (error) {
        console.error("In Hand: addresses save failed", error);
        notify("❌ Could not save addresses to Supabase");
        return;
      }
    }
    setDb(d => ({ ...d, users: d.users.map(u => u.id === activeUserId ? {...u, addresses: newAddresses} : u) }));
    notify("📍 Addresses saved!");
  };

  const handleSaveProfile = async ({ username, avatar, location, wishlist }) => {
    if (supabase) {
      const { error } = await updateOwnUser(activeUserId, { username, avatar, location, wishlist });
      if (error) {
        console.error("In Hand: profile save failed", error);
        notify("❌ Could not save profile to Supabase");
        return;
      }
    }
    setDb(d => ({ ...d, users: d.users.map(u => u.id === activeUserId ? {...u, username, avatar, location, wishlist} : u) }));
    notify("✅ Profile updated!");
  };

  const handleSubmitDispute = async ({ txn, shipment, reason, detail, disputeKind }) => {
    const isTrade = disputeKind === "trade";
    const counterpartyId = txn.buyerId === activeUserId ? txn.sellerId : txn.buyerId;
    const counterparty = getUser(counterpartyId);
    const dispute = {
      id: "d" + Date.now(),
      txnId: txn.id,
      raisedBy: activeUserId,
      againstUserId: counterpartyId,
      shipmentId: shipment?.id || null,
      reason,
      detail,
      status: "open",
      resolution: null,
      adminNote: null,
      raisedAt: new Date().toISOString().split("T")[0],
      resolvedAt: null,
      figureValue: txn.amount ?? 0,
      figureName: txn.cardName,
      disputeType: isTrade ? "trade" : "purchase",
      againstUsername: counterparty?.username || "",
    };
    if (supabase) {
      const { error: dErr } = await insertDispute(dispute);
      if (dErr) {
        console.error("In Hand: dispute insert failed", dErr);
        notify("❌ Could not file dispute in Supabase");
        return;
      }
      if (!isTrade && shipment?.id) {
        const { error: sErr } = await updateShipmentById(shipment.id, { disputeFrozen: true });
        if (sErr) {
          console.error("In Hand: dispute shipment freeze update failed", sErr);
          notify("❌ Could not file dispute in Supabase");
          return;
        }
      }
      if (!isTrade) {
        const { error: tErr } = await updateTransaction(txn.id, { status: "disputed" });
        if (tErr) {
          console.error("In Hand: dispute transaction status update failed", tErr);
          notify("❌ Could not file dispute in Supabase");
          return;
        }
      }
    }
    setDb((d) => ({
      ...d,
      disputes: [...(d.disputes || []), dispute],
      shipments:
        !isTrade && shipment?.id
          ? d.shipments.map((s) => (s.id === shipment.id ? { ...s, disputeFrozen: true } : s))
          : d.shipments,
      transactions: !isTrade
        ? d.transactions.map((t) => (t.id === txn.id ? { ...t, status: "disputed" } : t))
        : d.transactions,
    }));
    setDisputeModal(null);
    notify(
      isTrade
        ? "🤝 Trade dispute filed — support will review."
        : "🚨 Dispute filed — escrow frozen. Admin will review within 24h."
    );
  };

  const handleSubmitRating = async ({ txn, toUserId, score, comment, type }) => {
    const rating = { id:"r"+Date.now(), txnId:txn.id, fromUserId:activeUserId, toUserId, score, comment, type, date:new Date().toISOString().split("T")[0] };
    if (supabase) {
      const { error: rErr } = await insertRating(rating);
      if (rErr) {
        console.error("In Hand: rating insert failed", rErr);
        notify("❌ Could not submit rating in Supabase");
        return;
      }
      const { error: tErr } = await updateTransaction(txn.id, { rated: true });
      if (tErr) {
        console.error("In Hand: rating transaction update failed", tErr);
        notify("❌ Could not submit rating in Supabase");
        return;
      }
    }
    // Recalculate user rating average
    setDb(d => {
      const allRatings = [...(d.ratings||[]), rating].filter(r=>r.toUserId===toUserId);
      const newAvg = parseFloat((allRatings.reduce((s,r)=>s+r.score,0)/allRatings.length).toFixed(1));
      return {
        ...d,
        ratings: [...(d.ratings||[]), rating],
        users: d.users.map(u => u.id===toUserId ? {...u, rating:newAvg, tradesCompleted:u.tradesCompleted+1} : u),
        transactions: d.transactions.map(t => t.id===txn.id ? {...t, rated:true} : t),
      };
    });
    setRatingModal(null);
    notify("⭐ Rating submitted — thanks!");
  };

  const visibleSwipeData = swipeCards.slice(-4).map(id=>enriched.find(c=>c.id===id)).filter(Boolean).reverse();

  const goToTab = (id) => {
    setTab(id);
    if (id !== "messages") setActiveThread(null);
  };

  const txnColor = t => t.type==="purchase"?"#ff6b6b":(t.type==="sale"||t.type==="topup")?"#00b894":"#3A7BD5";
  const txnSign  = t => t.buyerId===activeUserId?"-":"+";
  const txnAmt   = t => t.buyerId===activeUserId?t.amount:t.net;

  return (
    <div className="inhand-shell">
      <style>{`
        @keyframes wordSlideUp{0%{opacity:0;transform:translateY(8px)}15%{opacity:1;transform:translateY(0)}75%{opacity:1;transform:translateY(0)}90%{opacity:0;transform:translateY(-8px)}100%{opacity:0;transform:translateY(-8px)}}
        .cycle-word{display:inline-block;animation:wordSlideUp 2.4s ease-in-out infinite;}
      `}</style>

      {toast && <div className="inhand-toast">{toast}</div>}
      {showAddCard && <AddCardModal ownerId={activeUserId} onSave={handleAddCard} onClose={()=>setShowAddCard(false)} />}
      {showAddUser && <AddUserModal onSave={handleAddUser} onClose={()=>setShowAddUser(false)} />}
      {checkoutCard && <CheckoutModal card={checkoutCard} seller={getUser(checkoutCard.ownerId)} onPayWithCard={()=>handlePurchaseWithCard(checkoutCard)} onClose={()=>setCheckoutCard(null)} />}
      {sweetenerTrade && <TradeSweetenerModal myFigure={sweetenerTrade.myFigure} theirFigure={sweetenerTrade.theirCard} theirOwner={getUser(sweetenerTrade.theirCard.ownerId)} myUser={myUser} onConfirm={handleSweetenerConfirm} onClose={()=>setSweetenerTrade(null)} />}
      {marketModal && <MarketValueModal card={marketModal} onClose={()=>setMarketModal(null)} />}
      {showAddressModal && <AddressModal addresses={myUser?.addresses||[]} onSave={handleSaveAddresses} onClose={()=>setShowAddressModal(false)} />}
      {showEditProfile && (
        <EditProfileModal
          user={myUser}
          initialTab={editProfileTab}
          onSave={handleSaveProfile}
          onExportData={handleExportMyData}
          onDeactivate={handleDeactivateAccount}
          onDeleteAccount={handleDeleteAccount}
          onClose={() => setShowEditProfile(false)}
        />
      )}
      {disputeModal && <DisputeModal txn={disputeModal.txn} shipment={disputeModal.shipment} disputeKind={disputeModal.disputeKind || "purchase"} onSubmit={handleSubmitDispute} onClose={()=>setDisputeModal(null)} />}
      {ratingModal && <RatingModal txn={ratingModal.txn} otherUser={ratingModal.otherUser} isBuyer={ratingModal.isBuyer} onSubmit={handleSubmitRating} onClose={()=>setRatingModal(null)} />}
      {showPackagingGuide && <PackagingGuideModal figureValue={addTrackingFor?.amount||0} onConfirm={()=>setShowPackagingGuide(false)} onClose={()=>setShowPackagingGuide(false)} />}
      {photoViewer && <PhotoViewer photos={photoViewer.photos} startIdx={photoViewer.startIdx||0} onClose={()=>setPhotoViewer(null)} />}
      {listingVideoModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:750, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={()=>setListingVideoModal(null)}>
          <div style={{ background:"#111", borderRadius:16, maxWidth:560, width:"100%", overflow:"hidden", position:"relative", boxShadow:"0 20px 60px rgba(0,0,0,0.5)" }} onClick={(e)=>e.stopPropagation()}>
            <button type="button" aria-label="Close video" onClick={()=>setListingVideoModal(null)} style={{ position:"absolute", top:10, right:10, zIndex:2, width:36, height:36, borderRadius:"50%", border:"none", background:"rgba(255,255,255,0.2)", color:"#fff", fontSize:18, cursor:"pointer" }}>✕</button>
            {listingVideoModal.type === "iframe" ? (
              <div style={{ position:"relative", paddingTop:"56.25%", background:"#000" }}>
                <iframe title="Listing video" src={listingVideoModal.src} style={{ position:"absolute", inset:0, width:"100%", height:"100%", border:"none" }} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
              </div>
            ) : (
              <video src={listingVideoModal.src} controls playsInline style={{ width:"100%", maxHeight:"70vh", display:"block" }} />
            )}
          </div>
        </div>
      )}
      {shareCard && <ShareModal card={shareCard} owner={getUser(shareCard.ownerId)} onOpenListingVideo={() => { const e = getListingVideoEmbed(shareCard.videoUrl); if (e) setListingVideoModal(e); }} onClose={()=>setShareCard(null)} />}
      {showNotifications && <NotificationCenter notifications={myNotifications} onMarkRead={markRead} onMarkAllRead={markAllRead} onClose={()=>setShowNotifications(false)} onNavigate={tab=>setTab(tab)} />}

      {/* TRACKING DETAIL MODAL */}
      {trackingModal && (() => {
        const s = trackingModal;
        const stepIdx = trackingStepIndex(s.status);
        return (
          <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:600,display:"flex",alignItems:"flex-end",justifyContent:"center" }}>
            <div style={{ background:"#fff",borderRadius:"28px 28px 0 0",padding:"24px 20px 40px",width:"100%",maxWidth:430,maxHeight:"85vh",overflowY:"auto" }}>
              <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20 }}>
                <div style={{ fontWeight:800,fontSize:18,color:"#2C3E50" }}>📦 Tracking</div>
                <button onClick={()=>setTrackingModal(null)} style={{ background:"#E4EBF2",border:"none",borderRadius:"50%",width:32,height:32,fontSize:16,cursor:"pointer" }}>✕</button>
              </div>
              {/* Figure */}
              <div style={{ background:"#f9f9f9",borderRadius:16,padding:"12px 14px",marginBottom:16,display:"flex",alignItems:"center",gap:12 }}>
                <div style={{ fontSize:32 }}>📮</div>
                <div>
                  <div style={{ fontWeight:800,fontSize:14,color:"#2C3E50" }}>{s.figureName}</div>
                  <div style={{ fontSize:11,color:"#aaa" }}>{s.carrier} · ${fmt(s.shippingCost)}</div>
                  {s.trackingNumber && <div style={{ fontSize:10,color:"#888",marginTop:2,fontFamily:"monospace" }}>{s.trackingNumber}</div>}
                </div>
              </div>
              {/* Progress bar */}
              <div style={{ marginBottom:20 }}>
                <div style={{ display:"flex",justifyContent:"space-between",marginBottom:8 }}>
                  {TRACKING_STEPS.map((step,i)=>(
                    <div key={step} style={{ textAlign:"center",flex:1 }}>
                      <div style={{ width:28,height:28,borderRadius:"50%",background:i<=stepIdx?"#2C3E50":"#E4EBF2",margin:"0 auto 4px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:i<=stepIdx?"#fff":"#ccc",border:i===stepIdx?"3px solid #4A90D9":"none",transition:"all 0.3s" }}>
                        {i<stepIdx?"✓":i===stepIdx?"●":"○"}
                      </div>
                      <div style={{ fontSize:8,color:i<=stepIdx?"#2C3E50":"#ccc",fontWeight:i===stepIdx?800:600,lineHeight:1.2 }}>{step}</div>
                    </div>
                  ))}
                </div>
                <div style={{ height:3,background:"#E4EBF2",borderRadius:4,marginTop:4,position:"relative" }}>
                  <div style={{ height:"100%",background:"linear-gradient(90deg,#2C3E50,#4A90D9)",borderRadius:4,width:`${(stepIdx/4)*100}%`,transition:"width 0.5s" }} />
                </div>
              </div>
              {/* Events */}
              <div style={{ fontWeight:700,fontSize:13,color:"#2C3E50",marginBottom:10 }}>Tracking History</div>
              {s.events.length===0 ? <div style={{ color:"#ccc",fontSize:12,textAlign:"center",padding:"20px 0" }}>No events yet — waiting for seller to ship</div>
                : [...s.events].reverse().map((ev,i)=>(
                <div key={i} style={{ display:"flex",gap:12,marginBottom:12,paddingBottom:12,borderBottom:i<s.events.length-1?"1px solid #EEF2F7":"none" }}>
                  <div style={{ width:8,height:8,borderRadius:"50%",background:i===0?"#00b894":"#ddd",marginTop:4,flexShrink:0 }} />
                  <div>
                    <div style={{ fontWeight:700,fontSize:12,color:"#2C3E50" }}>{ev.description}</div>
                    <div style={{ fontSize:10,color:"#aaa",marginTop:2 }}>{ev.location} · {ev.date}</div>
                  </div>
                </div>
              ))}
              {/* Auto-release status */}
              {s.status==="delivered" && !s.fundsReleased && s.deliveredAt && (() => {
                const hoursLeft = Math.max(0, 168 - (Date.now() - new Date(s.deliveredAt).getTime()) / 3600000);
                const hh = Math.floor(hoursLeft);
                const mm = Math.floor((hoursLeft - hh) * 60);
                return (
                  <div style={{ background:"#fff8e6",border:"2px solid #f9ca24",borderRadius:16,padding:"14px",marginTop:16,textAlign:"center" }}>
                    <div style={{ fontSize:32,marginBottom:6 }}>⏱️</div>
                    <div style={{ fontWeight:800,fontSize:15,color:"#2C3E50",marginBottom:4 }}>Funds auto-release in</div>
                    <div style={{ fontWeight:900,fontSize:28,color:"#f0932b",marginBottom:4 }}>{hh}h {mm}m</div>
                    <div style={{ fontSize:11,color:"#aaa" }}>Payment releases automatically to seller 7 days after delivery. No action needed.</div>
                  </div>
                );
              })()}
              {s.fundsReleased && (
                <div style={{ background:"#f0fff8",borderRadius:12,padding:"14px",textAlign:"center",marginTop:16 }}>
                  <div style={{ fontSize:28,marginBottom:4 }}>✅</div>
                  <div style={{ fontWeight:800,fontSize:14,color:"#00b894" }}>{s.autoReleased?"Funds auto-released to seller":"Funds released to seller"}</div>
                  <div style={{ fontSize:11,color:"#aaa",marginTop:4 }}>Transaction complete</div>
                </div>
              )}
              {/* Simulate delivery button for demo */}
              {s.status!=="delivered" && s.trackingNumber && (
                <button onClick={()=>{simulateDelivery(s.id);setTrackingModal({...s,status:"delivered",events:[...s.events,{date:new Date().toISOString().slice(0,16).replace("T"," "),location:"Destination",description:"Delivered — Front Door"}]});}} style={{ width:"100%",background:"#EEF2F7",border:"none",borderRadius:12,padding:"10px",fontWeight:700,fontSize:12,color:"#888",cursor:"pointer",marginTop:12 }}>🎭 Simulate Delivery (demo)</button>
              )}
              {/* Report a Problem — buyer only, within 7d of delivery */}
              {s.status==="delivered" && s.toUser===activeUserId && !s.fundsReleased && !s.disputeFrozen && (() => {
                const txn = db.transactions.find(t=>t.id===s.txnId);
                return txn ? (
                  <button onClick={()=>setDisputeModal({ txn, shipment:s, disputeKind:"purchase" })} style={{ width:"100%",background:"#fff0f0",border:"2px solid #ff6b6b",borderRadius:12,padding:"11px",fontWeight:800,fontSize:13,color:"#ff6b6b",cursor:"pointer",marginTop:10,display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}>
                    🚨 Report a Problem
                  </button>
                ) : null;
              })()}
              {s.disputeFrozen && (
                <div style={{ background:"#fff0f0",border:"2px solid #ff6b6b",borderRadius:12,padding:"12px",marginTop:10,textAlign:"center" }}>
                  <div style={{ fontWeight:800,fontSize:13,color:"#ff6b6b" }}>🔒 Dispute in Progress</div>
                  <div style={{ fontSize:11,color:"#aaa",marginTop:4 }}>Escrow frozen — admin reviewing</div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* LABEL GENERATION MODAL */}
      {addTrackingFor && (() => {
        const s = addTrackingFor;
        const rate = getShippingRate(s.figureValue);
        const seller = getUser(s.fromUser);
        const buyer  = getUser(s.toUser);
        return <LabelModal shipment={s} rate={rate} seller={seller} buyer={buyer} sellerAddresses={myUser?.addresses||[]}
          onGenerate={(tn) => { handleAddTracking(s.txnId || s.id, tn); }}
          onClose={() => setAddTrackingFor(null)} />;
      })()}

      <aside className="inhand-sidebar" aria-label="Main navigation">
        <div className="inhand-sidebar-brand">
          <div className="inhand-brand-title">In Hand</div>
          <div className="inhand-brand-subtitle">Collector marketplace</div>
        </div>
        <nav className="inhand-sidebar-nav">
          {NAV_ITEMS.map(([id, label]) => (
            <button key={id} type="button" data-active={tab === id ? "true" : "false"} onClick={() => goToTab(id)}>
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="inhand-app-body">
      {!(tab === "messages" && activeThread) && (
      <header className="inhand-header">
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
          <div className="inhand-brand-lockup">
            <div className="inhand-brand-logo">
              <img src={LOGO_IMG} alt="In Hand" />
            </div>
            <div className="inhand-brand-copy">
              <div className="inhand-brand-title">In Hand</div>
              <CyclingSubtitle />
            </div>
          </div>
          <div className="inhand-header-actions">
            {liked.length>0 && (
              <button type="button" onClick={()=>setTab("trades")} className="inhand-pill" style={{ background:"#1f4f82", color:"#fff" }}>
                {liked.length} pending
              </button>
            )}
            <button type="button" onClick={() => setShowNotifications(true)} className="inhand-icon-button" aria-label="Notifications">
              <BellIcon />
              {unreadNotifCount > 0 && <span className="inhand-badge-dot">{unreadNotifCount > 9 ? "9+" : unreadNotifCount}</span>}
            </button>
            <button type="button" onClick={() => setTab("account")} className="inhand-icon-button" aria-label="Account" style={{ border:"none", padding:0 }}>
              <UserAvatar user={myUser} size={40} />
            </button>
          </div>
        </div>
        <div className="inhand-segmented">
          {NAV_ITEMS.map(([id, label]) => (
            <button key={id} type="button" data-active={tab === id ? "true" : "false"} onClick={() => goToTab(id)}>
              {label}
            </button>
          ))}
        </div>
      </header>
      )}

      {/* ── BROWSE ── */}
      {tab==="browse" && (
        <main className="inhand-main">
          <div className="inhand-search">
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search figures, lines, collectors" style={IS} />
          </div>
          {/* Brand filter */}
          <div className="inhand-chip-row">
            {ALL_BRANDS.map(brand => (
              <button key={brand} type="button" className="inhand-chip" data-active={brandFilter === brand ? "true" : "false"} onClick={() => { setBrandFilter(brand); setLineFilter("All"); }}>
                {brand}
              </button>
            ))}
          </div>
          {/* Line filter — shows only lines for selected brand */}
          {brandFilter !== "All" && (
            <div style={{ display:"flex",gap:6,overflowX:"auto",paddingBottom:4,marginBottom:8 }}>
              <button onClick={()=>setLineFilter("All")} style={{ flexShrink:0,background:lineFilter==="All"?"#3A7BD5":"#EEF2F7",border:"1.5px solid",borderColor:lineFilter==="All"?"#3A7BD5":"#DCE6F0",borderRadius:20,padding:"4px 12px",fontSize:10,fontWeight:700,color:lineFilter==="All"?"#fff":"#888",cursor:"pointer" }}>All Lines</button>
              {getLinesForBrand(brandFilter).map(line=>(
                <button key={line} onClick={()=>setLineFilter(line)} style={{ flexShrink:0,background:lineFilter===line?"#3A7BD5":"#EEF2F7",border:"1.5px solid",borderColor:lineFilter===line?"#3A7BD5":"#DCE6F0",borderRadius:20,padding:"4px 12px",fontSize:10,fontWeight:700,color:lineFilter===line?"#fff":"#888",cursor:"pointer",whiteSpace:"nowrap" }}>{line}</button>
              ))}
            </div>
          )}
          <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:14 }}>
            <div style={{ display:"flex",background:"#DCE6F0",borderRadius:10,padding:3,gap:2 }}>
              {[["all","All"],["trade","Trade"],["buy","Buy"]].map(([f,l])=><button key={f} onClick={()=>setTypeFilter(f)} style={{ background:typeFilter===f?"#fff":"transparent",border:"none",borderRadius:7,padding:"4px 9px",fontSize:11,fontWeight:700,color:typeFilter===f?"#2C3E50":"#aaa",cursor:"pointer" }}>{l}</button>)}
            </div>
            <div style={{ display:"flex",background:"#DCE6F0",borderRadius:10,padding:3,gap:2 }}>
              {[["match","% Match"],["value","$ Value"]].map(([s,l])=><button key={s} onClick={()=>setSortBy(s)} style={{ background:sortBy===s?"#fff":"transparent",border:"none",borderRadius:7,padding:"4px 9px",fontSize:11,fontWeight:700,color:sortBy===s?"#2C3E50":"#aaa",cursor:"pointer" }}>{l}</button>)}
            </div>
            <div style={{ marginLeft:"auto",display:"flex",background:"#DCE6F0",borderRadius:10,padding:3,gap:2 }}>
              {[["list","List"],["grid","Grid"]].map(([v,i])=><button key={v} onClick={()=>setViewMode(v)} style={{ background:viewMode===v?"#fff":"transparent",border:"none",borderRadius:7,padding:"4px 9px",fontSize:13,cursor:"pointer" }}>{i}</button>)}
            </div>
          </div>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12 }}>
            <div style={{ fontSize:12,color:"#bbb",fontWeight:600 }}>{filtered.length} listings</div>
            {filtered.length>0&&<button type="button" onClick={() => launchSwipe(filtered)} className="inhand-pill" style={{ background:"#1f4f82", color:"#fff" }}>Review {filtered.length}</button>}
          </div>
          {filtered.length === 0 && (
            <div className="inhand-empty">
              <h3>No listings found</h3>
              <p>Try adjusting your filters or search for something else.</p>
              <button onClick={()=>{ setSearch(""); setLineFilter("All"); setTypeFilter("all"); }} style={{ background:"#2C3E50",border:"none",borderRadius:12,padding:"10px 22px",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer" }}>Clear Filters</button>
            </div>
          )}
          {viewMode==="list"
            ? filtered.map(card => {
                const {from,light}=lc(card.line); const sc=card.matchScore>=85?"#00b894":card.matchScore>=70?"#f9ca24":"#4A90D9";
                return (
                  <div key={card.id} className="inhand-listing-card">
                    <div style={{ display:"flex",gap:12,alignItems:"center" }}>
                      <FigureImage
                        card={card}
                        size={62}
                        borderRadius={16}
                        onClick={card.photos?.length>0?()=>setPhotoViewer({photos:card.photos,startIdx:0}):undefined}
                        onVideoOpen={() => { const e = getListingVideoEmbed(card.videoUrl); if (e) setListingVideoModal(e); }}
                      />
                      <div style={{ flex:1,minWidth:0 }}>
                        <div style={{ fontWeight:800,fontSize:14,color:"#2C3E50" }}>{card.name}</div>
                        <div style={{ fontSize:11,color:"#8a97a6",marginTop:1 }}>{card.brand ? `${card.brand} · ` : ""}{card.line}</div>
                        {card.description && <div style={{ fontSize:11,color:"#888",marginTop:3,lineHeight:1.4,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden" }}>{card.description}</div>}
                        <div style={{ display:"flex",gap:6,marginTop:6,alignItems:"center",flexWrap:"wrap" }}>
                          <span style={{ fontSize:10,fontWeight:800,background:condBg(card.isNew),color:condColor(card.isNew),borderRadius:6,padding:"2px 8px" }}>{condLabel(card.isNew)}</span>
                          <span style={{ fontSize:13,fontWeight:800,color:from }}>${card.value}</span>
                          <MarketBadge name={card.name} value={card.value} isNew={card.isNew} mini />
                          {card.wantsTrade && <span style={{ fontSize:10,fontWeight:600,background:"#edf7f2",color:"#1f7a5c",borderRadius:999,padding:"2px 8px" }}>Trade</span>}
                          {card.wantsBuy && <span style={{ fontSize:10,fontWeight:600,background:"#fbf4df",color:"#9a6700",borderRadius:999,padding:"2px 8px" }}>Buy</span>}
                        </div>
                        {/* Market avg line */}
                        {(() => { const mv=getMarketValue(card.name); const tier=card.isNew?mv?.new:mv?.used; return tier ? (
                          <div onClick={()=>setMarketModal(card)} style={{ display:"flex",alignItems:"center",gap:5,marginTop:5,cursor:"pointer" }}>
                            <span style={{ fontSize:10,color:"#aaa" }}>{condLabel(card.isNew)} avg <strong style={{color:"#555"}}>${tier.avg}</strong></span>
                            <span style={{ fontSize:10,color:"#3A7BD5",fontWeight:700 }}>· See chart →</span>
                          </div>
                        ) : null; })()}
                      </div>
                      <div style={{ textAlign:"center",flexShrink:0 }}>
                        <div style={{ width:40,height:40,borderRadius:"50%",background:`conic-gradient(${sc} ${card.matchScore*3.6}deg,#E4EBF2 0)`,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:`0 0 0 2px #fff,0 0 0 3px ${sc}33` }}><div style={{ width:30,height:30,borderRadius:"50%",background:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:11,color:sc }}>{card.matchScore}</div></div>
                        <div style={{ fontSize:8,color:"#ccc",fontWeight:700,marginTop:2 }}>MATCH</div>
                      </div>
                    </div>
                    <div style={{ display:"flex",alignItems:"center",gap:6,marginTop:10,paddingTop:10,borderTop:"1px solid #EEF2F7", flexWrap:"wrap" }}>
                      <UserAvatar user={card.owner} size={28} style={{ borderRadius:10, fontSize:10 }} />
                      <span style={{ fontSize:11,fontWeight:700,color:"#888" }}>{card.owner?.username}</span>
                      {card.owner?.verified && <VerifiedInHandBadge compact />}
                      <span style={{ fontSize:10,color:"#8a97a6" }}>Rating {card.owner?.rating}</span>
                      <div style={{ marginLeft:"auto",display:"flex",gap:6 }}>
                        <button type="button" onClick={() => setMarketModal(card)} className="inhand-text-button">Market</button>
                        <button type="button" onClick={() => setShareCard(card)} className="inhand-text-button">Share</button>
                        {card.wantsTrade && <button type="button" onClick={() => openThread(card.owner?.id || card.ownerId, card)} className="inhand-text-button">Message</button>}
                        {card.wantsBuy&&<button onClick={()=>setCheckoutCard(card)} style={{ background:"#2C3E50",border:"none",borderRadius:10,padding:"6px 14px",color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer" }}>Buy ${card.value}</button>}
                      </div>
                    </div>
                  </div>
                );
              })
            : <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                {filtered.map(card=>{
                  const {from,light}=lc(card.line); const sc=card.matchScore>=85?"#00b894":card.matchScore>=70?"#f9ca24":"#4A90D9";
                  return (
                    <div key={card.id} onClick={()=>launchSwipe([card])} style={{ background:"#fff",borderRadius:18,overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,0.06)",border:"1px solid #E4EBF2",cursor:"pointer" }}>
                      <div style={{ background:light, height:130, position:"relative", overflow:"hidden" }}>
                        {card.photos?.length>0
                          ? <img src={card.photos[0]} alt={card.name} onClick={()=>setPhotoViewer({photos:card.photos,startIdx:0})} style={{ width:"100%", height:"100%", objectFit:"cover", cursor:"pointer" }} />
                          : <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:52 }}>{card.image}</div>
                        }
                        {card.photos?.length>1 && <div style={{ position:"absolute", bottom:5, right:5, background:"rgba(0,0,0,0.55)", borderRadius:6, fontSize:9, color:"#fff", padding:"1px 5px", fontWeight:700 }}>+{card.photos.length-1}</div>}
                        {getListingVideoEmbed(card.videoUrl) && (
                          <button
                            type="button"
                            aria-label="Play listing video"
                            onClick={e => {
                              e.stopPropagation();
                              const emb = getListingVideoEmbed(card.videoUrl);
                              if (emb) setListingVideoModal(emb);
                            }}
                            style={{ position:"absolute", bottom:5, left:5, width:30, height:30, borderRadius:"50%", border:"none", background:"rgba(0,0,0,0.68)", color:"#fff", fontSize:11, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", paddingLeft:2, boxShadow:"0 2px 8px rgba(0,0,0,0.25)" }}
                          >
                            ▶
                          </button>
                        )}
                      </div>
                      <div style={{ padding:"12px" }}>
                        <div style={{ fontWeight:800,fontSize:12,color:"#2C3E50",lineHeight:1.3,marginBottom:3 }}>{card.name}</div>
                        <div style={{ fontSize:10,color:"#bbb",marginBottom:6 }}>{card.line}</div>
                        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between" }}>
                          <span style={{ fontWeight:800,fontSize:13,color:from }}>${card.value}</span>
                          <div style={{ width:32,height:32,borderRadius:"50%",background:`conic-gradient(${sc} ${card.matchScore*3.6}deg,#E4EBF2 0)`,display:"flex",alignItems:"center",justifyContent:"center" }}><div style={{ width:22,height:22,borderRadius:"50%",background:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:9,color:sc }}>{card.matchScore}</div></div>
                        </div>
                        <MarketBadge name={card.name} value={card.value} isNew={card.isNew} mini />
                        <div style={{ display:"flex",gap:6,marginTop:8 }}>
                          <button onClick={e=>{e.stopPropagation();setMarketModal(card);}} style={{ flex:1,background:"#EAF1FA",border:"none",borderRadius:8,padding:"5px",color:"#3A7BD5",fontWeight:700,fontSize:11,cursor:"pointer" }}>📊</button>
                          <button onClick={e=>{e.stopPropagation();setShareCard(card);}} style={{ flex:1,background:"#EEF2F7",border:"none",borderRadius:8,padding:"5px",color:"#555",fontWeight:700,fontSize:11,cursor:"pointer" }}>↗️</button>
                          {card.wantsBuy&&<button onClick={e=>{e.stopPropagation();setCheckoutCard(card);}} style={{ flex:2,background:"#2C3E50",border:"none",borderRadius:8,padding:"5px",color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer" }}>Buy ${card.value}</button>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
          }
        </main>
      )}

      {/* ── MESSAGES ── */}
      {tab==="messages" && (
        <MessagingScreen
          threads={myThreads}
          activeThreadId={activeThread}
          setActiveThread={setActiveThread}
          currentUserId={activeUserId}
          getUser={getUser}
          onSend={sendMessage}
          onFlag={flagMessage}
        />
      )}

      {/* ── SHIPPING ── */}
      {tab==="shipping" && (
        <div style={{ flex:1,overflowY:"auto",padding:"20px 20px 90px" }}>
          <div style={{ fontWeight:800,fontSize:18,color:"#2C3E50",marginBottom:4 }}>📦 Shipping & Tracking</div>
          <div style={{ fontSize:12,color:"#bbb",marginBottom:16 }}>All shipments use USPS Ground Advantage</div>

          {/* USPS rates info card */}
          <div style={{ background:"linear-gradient(135deg,#2C3E50,#2d3561)",borderRadius:20,padding:"18px",marginBottom:20 }}>
            <div style={{ fontWeight:800,fontSize:13,color:"#fff",marginBottom:12 }}>📮 USPS Ground Advantage Rates</div>
            {USPS_RATES.map((r,i)=>(
              <div key={i} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,paddingBottom:8,borderBottom:i<USPS_RATES.length-1?"1px solid rgba(255,255,255,0.1)":"none" }}>
                <div>
                  <div style={{ fontSize:12,color:"rgba(255,255,255,0.9)",fontWeight:600 }}>{r.label}</div>
                  <div style={{ fontSize:10,color:"rgba(255,255,255,0.4)" }}>Items up to ${i===USPS_RATES.length-1?"any value":r.maxValue}</div>
                </div>
                <div style={{ fontWeight:900,fontSize:15,color:"#00b894" }}>${r.price.toFixed(2)}</div>
              </div>
            ))}
          </div>

          {/* Active shipments */}
          {(() => {
            const myShipments = (db.shipments||[]).filter(s=>s.fromUser===activeUserId||s.toUser===activeUserId);
            if(myShipments.length===0) return <div style={{ textAlign:"center",padding:"40px 0",color:"#ccc" }}><div style={{ fontSize:48,marginBottom:12 }}>📭</div><div style={{ fontWeight:700,fontSize:15 }}>No shipments yet</div></div>;
            return myShipments.map(s=>{
              const isSeller = s.fromUser===activeUserId;
              const statusColor = s.status==="delivered"?"#00b894":s.status==="in_transit"||s.status==="accepted"?"#3A7BD5":s.status==="out_for_delivery"?"#f9ca24":"#aaa";
              const statusLabel = s.status==="delivered"?"Delivered":s.status==="in_transit"?"In Transit":s.status==="accepted"?"Accepted":s.status==="out_for_delivery"?"Out for Delivery":"Label Pending";
              const stepIdx = trackingStepIndex(s.status);
              return (
                <div key={s.id} style={{ background:"#fff",borderRadius:20,padding:"16px",boxShadow:"0 2px 14px rgba(0,0,0,0.06)",border:"1px solid #E4EBF2",marginBottom:14 }}>
                  {/* Header */}
                  <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12 }}>
                    <div>
                      <div style={{ fontWeight:800,fontSize:14,color:"#2C3E50" }}>{s.figureName}</div>
                      <div style={{ fontSize:11,color:"#aaa",marginTop:2 }}>{isSeller?"You're sending":"You're receiving"} · {s.carrier}</div>
                    </div>
                    <span style={{ fontSize:10,background:`${statusColor}18`,color:statusColor,borderRadius:8,padding:"3px 10px",fontWeight:800 }}>{statusLabel}</span>
                  </div>

                  {/* Mini progress */}
                  <div style={{ display:"flex",gap:4,marginBottom:12,alignItems:"center" }}>
                    {TRACKING_STEPS.map((step,i)=>(
                      <div key={i} style={{ flex:1,height:4,borderRadius:4,background:i<=stepIdx?"#2C3E50":"#E4EBF2",transition:"background 0.3s" }} />
                    ))}
                  </div>

                  {/* Tracking number */}
                  {s.trackingNumber
                    ? <div style={{ background:"#f9f9f9",borderRadius:10,padding:"8px 12px",marginBottom:12,display:"flex",alignItems:"center",gap:8 }}>
                        <span style={{ fontSize:12 }}>🔢</span>
                        <span style={{ fontFamily:"monospace",fontSize:11,color:"#555",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{s.trackingNumber}</span>
                      </div>
                    : isSeller && <div style={{ background:"#fff8e6",border:"1.5px dashed #f9ca24",borderRadius:10,padding:"8px 12px",marginBottom:12,fontSize:11,color:"#f0932b",fontWeight:600 }}>
                        ⚠️ Generate your prepaid label below and ship the item
                      </div>
                  }

                  {/* Escrow notice */}
                  {!s.fundsReleased && s.status!=="delivered" && (
                    <div style={{ background:"#EAF1FA",borderRadius:10,padding:"8px 12px",marginBottom:12,fontSize:11,color:"#3A7BD5",fontWeight:600 }}>
                      🔒 ${fmt(s.figureValue)} held in escrow — releases on delivery
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display:"flex",gap:8 }}>
                    {isSeller && !s.trackingNumber && (
                      <button onClick={()=>setAddTrackingFor(s)} style={{ flex:2,background:"linear-gradient(135deg,#2C3E50,#2d3561)",border:"none",borderRadius:12,padding:"9px",fontWeight:700,fontSize:12,color:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}>
                        🏷️ Generate Label
                      </button>
                    )}
                    {isSeller && s.trackingNumber && !s.fundsReleased && (
                      <div style={{ flex:1,background:"#f0fff8",borderRadius:12,padding:"9px",fontWeight:700,fontSize:11,color:"#00b894",textAlign:"center" }}>📮 Shipped</div>
                    )}
                    <button onClick={()=>setTrackingModal(s)} style={{ flex:1,background:"#EEF2F7",border:"none",borderRadius:12,padding:"9px",fontWeight:700,fontSize:12,color:"#555",cursor:"pointer" }}>Track</button>
                    {s.fundsReleased && <div style={{ flex:1,background:"#f0fff8",borderRadius:12,padding:"9px",fontWeight:700,fontSize:12,color:"#00b894",textAlign:"center" }}>✅ {s.autoReleased?"Auto-paid":"Paid out"}</div>}
                  </div>

                  {/* Auto-release countdown */}
                  {s.status==="delivered" && !s.fundsReleased && s.deliveredAt && (() => {
                    const hoursLeft = Math.max(0, 168 - (Date.now() - new Date(s.deliveredAt).getTime()) / 3600000);
                    const hh = Math.floor(hoursLeft);
                    const mm = Math.floor((hoursLeft - hh) * 60);
                    return (
                      <div style={{ background:"#fff8e6",borderRadius:10,padding:"8px 12px",marginTop:10,display:"flex",alignItems:"center",justifyContent:"space-between" }}>
                        <span style={{ fontSize:11,fontWeight:600,color:"#f0932b" }}>⏱️ Auto-release in</span>
                        <span style={{ fontWeight:900,fontSize:14,color:"#f0932b" }}>{hh}h {mm}m</span>
                      </div>
                    );
                  })()}
                </div>
              );
            });
          })()}
        </div>
      )}

      {/* ── WALLET ── */}
      {tab==="wallet" && (
        <div style={{ flex:1,overflowY:"auto",padding:"20px 20px 90px" }}>
          <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:16 }}>
            <button onClick={()=>setTab("account")} style={{ background:"#E4EBF2",border:"none",borderRadius:10,padding:"6px 12px",fontSize:12,fontWeight:700,color:"#555",cursor:"pointer" }}>← Account</button>
            <div style={{ fontWeight:800,fontSize:18,color:"#2C3E50" }}>Wallet & Payments</div>
          </div>
          {/* Balance card */}
          <div style={{ background:"linear-gradient(135deg,#2C3E50,#2d2d4e)",borderRadius:24,padding:"28px 24px",marginBottom:20,position:"relative",overflow:"hidden" }}>
            <div style={{ position:"absolute",top:-20,right:-20,width:120,height:120,borderRadius:"50%",background:"rgba(255,255,255,0.04)" }} />
            <div style={{ position:"absolute",bottom:-30,left:-10,width:80,height:80,borderRadius:"50%",background:"rgba(255,255,255,0.03)" }} />
            <div style={{ fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.5)",letterSpacing:1.5,marginBottom:8 }}>SALE EARNINGS</div>
            <div style={{ fontWeight:900,fontSize:42,color:"#fff",letterSpacing:-1,marginBottom:4 }}>${fmt(myUser?.walletBalance||0)}</div>
            <div style={{ fontSize:12,color:"rgba(255,255,255,0.45)" }}>{myUser?.username} · {myUser?.location}</div>
          </div>

          <div style={{ background:"#f0fff8",border:"1.5px solid #00b89433",borderRadius:16,padding:"14px 16px",marginBottom:20,fontSize:12,color:"#555",lineHeight:1.55 }}>
            <div style={{ fontWeight:800,color:"#00b894",marginBottom:6 }}>How your wallet works</div>
            <div style={{ marginBottom:6 }}>• <strong>Buy figures:</strong> pay with card at checkout (Stripe).</div>
            <div style={{ marginBottom:6 }}>• <strong>Get paid:</strong> after delivery, escrow releases to this balance.</div>
            <div>• <strong>Trade sweeteners:</strong> you can spend earnings here if you have enough.</div>
            <div style={{ marginTop:10,fontSize:11,color:"#888" }}>Bank payout (withdraw) — coming soon.</div>
          </div>

          {/* Payment methods */}
          <div style={{ fontWeight:800,fontSize:15,color:"#2C3E50",marginBottom:12 }}>Payment Methods</div>
          {myUser?.paymentMethods.map(pm=>(
            <div key={pm.id} style={{ background:"#fff",borderRadius:16,padding:"14px 16px",marginBottom:10,boxShadow:"0 2px 10px rgba(0,0,0,0.05)",border:"1px solid #E4EBF2",display:"flex",alignItems:"center",gap:12 }}>
              <div style={{ fontSize:28 }}>{pm.type==="paypal"?"💙":"💳"}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700,fontSize:13,color:"#2C3E50" }}>{pm.type==="paypal"?`PayPal · ${pm.email}`:`${pm.brand} ···· ${pm.last4}`}</div>
                {pm.expiry&&<div style={{ fontSize:11,color:"#aaa" }}>Expires {pm.expiry}</div>}
              </div>
              {pm.isDefault&&<span style={{ fontSize:9,background:"#e8fff6",color:"#00b894",borderRadius:6,padding:"2px 8px",fontWeight:700 }}>DEFAULT</span>}
            </div>
          ))}
          <div style={{ background:"#EAF1FA",borderRadius:14,padding:"14px 16px",marginBottom:24,fontSize:12,color:"#555",lineHeight:1.55 }}>
            Purchases use <strong>Stripe Checkout</strong> — enter your card when you buy a listing. Saved cards here are for display only until Stripe Customer is wired.
          </div>

          {/* Transaction history */}
          <div style={{ fontWeight:800,fontSize:15,color:"#2C3E50",marginBottom:12 }}>Transaction History</div>
          {myTxns.length===0 ? <div style={{ textAlign:"center",padding:"30px 0",color:"#ccc",fontSize:13 }}>No transactions yet</div>
            : myTxns.map(txn => {
              const isBuyer = txn.buyerId===activeUserId;
              const col = isBuyer?"#ff6b6b":"#00b894";
              const statusColor = txn.status==="completed"?"#00b894":txn.status==="in_escrow"?"#3A7BD5":txn.status==="disputed"?"#ff6b6b":"#f9ca24";
              const otherUserId = isBuyer ? txn.sellerId : txn.buyerId;
              const otherUser = getUser(otherUserId);
              const alreadyRated = (db.ratings||[]).some(r=>r.txnId===txn.id&&r.fromUserId===activeUserId);
              const shipment = (db.shipments||[]).find(s=>s.txnId===txn.id);
              const canDispute = isBuyer && txn.status==="in_escrow" && shipment?.status==="delivered" && !shipment?.disputeFrozen;
              const tradeDisputeOpen = txn.type==="trade" && (db.disputes||[]).some(d=>d.txnId===txn.id && d.status==="open");
              const canTradeDispute = txn.type==="trade" && txn.status==="completed" && !tradeDisputeOpen;
              const showActions = (txn.status==="completed" && !alreadyRated && otherUser) || canDispute || canTradeDispute;
              return (
                <div key={txn.id} style={{ background:"#fff",borderRadius:16,padding:"14px 16px",marginBottom:10,boxShadow:"0 2px 10px rgba(0,0,0,0.05)",border:`1px solid ${txn.status==="disputed"?"#ff6b6b22":"#E4EBF2"}` }}>
                  <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom: showActions || tradeDisputeOpen ? 10 : 0 }}>
                    <div style={{ width:42,height:42,borderRadius:12,background:isBuyer?"#fff0f0":"#f0fff8",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0 }}>{txn.type==="trade"?"🤝":(isBuyer?"🛒":"💸")}</div>
                    <div style={{ flex:1,minWidth:0 }}>
                      <div style={{ fontWeight:700,fontSize:13,color:"#2C3E50",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{txn.cardName}</div>
                      <div style={{ fontSize:10,color:"#bbb",marginTop:2 }}>{txn.date} · {txn.type==="trade"?"Trade":(isBuyer?"Purchased":"Sold")} · {txn.method}</div>
                      <div style={{ display:"flex",gap:5,marginTop:4,alignItems:"center",flexWrap:"wrap" }}>
                        <span style={{ fontSize:9,background:`${statusColor}18`,color:statusColor,borderRadius:5,padding:"1px 7px",fontWeight:700 }}>{txn.status}</span>
                        {alreadyRated && <span style={{ fontSize:9,background:"#fff8e6",color:"#f9ca24",borderRadius:5,padding:"1px 7px",fontWeight:700 }}>⭐ Rated</span>}
                        {txn.status==="disputed" && <span style={{ fontSize:9,background:"#fff0f0",color:"#ff6b6b",borderRadius:5,padding:"1px 7px",fontWeight:700 }}>🔒 Escrow frozen</span>}
                        {tradeDisputeOpen && <span style={{ fontSize:9,background:"#fff0f0",color:"#ff6b6b",borderRadius:5,padding:"1px 7px",fontWeight:700 }}>🤝 Trade dispute open</span>}
                      </div>
                    </div>
                    <div style={{ textAlign:"right",flexShrink:0 }}>
                      <div style={{ fontWeight:900,fontSize:15,color:col }}>{isBuyer?"-":"+"}${isBuyer?txn.amount:fmt(txn.net)}</div>
                      {txn.fee>0&&<div style={{ fontSize:9,color:"#ccc" }}>fee ${fmt(txn.fee)}</div>}
                    </div>
                  </div>
                  {/* Action buttons */}
                  {showActions && (
                    <div style={{ display:"flex",gap:8,paddingTop:10,borderTop:"1px solid #EEF2F7" }}>
                      {txn.status==="completed" && !alreadyRated && otherUser && (
                        <button onClick={()=>setRatingModal({ txn, otherUser, isBuyer })} style={{ flex:1,background:"linear-gradient(135deg,#f9ca24,#f0932b)",border:"none",borderRadius:10,padding:"8px",fontWeight:800,fontSize:12,color:"#fff",cursor:"pointer" }}>
                          ⭐ Rate {otherUser.username.split("_")[0]}
                        </button>
                      )}
                      {canDispute && (
                        <button onClick={()=>setDisputeModal({ txn, shipment, disputeKind:"purchase" })} style={{ flex:1,background:"#fff0f0",border:"2px solid #ff6b6b",borderRadius:10,padding:"8px",fontWeight:700,fontSize:12,color:"#ff6b6b",cursor:"pointer" }}>
                          🚨 Report Problem
                        </button>
                      )}
                      {canTradeDispute && (
                        <button type="button" onClick={()=>setDisputeModal({ txn, shipment: null, disputeKind:"trade" })} style={{ flex:1,background:"#EAF1FA",border:"2px solid #3A7BD5",borderRadius:10,padding:"8px",fontWeight:700,fontSize:12,color:"#3A7BD5",cursor:"pointer" }}>
                          🤝 Trade issue
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          }
        </div>
      )}

      {/* ── SWIPE (review mode — only when launched from Browse) ── */}
      {tab==="swipe" && (
        <div style={{ flex:1,display:"flex",flexDirection:"column" }}>
          <div style={{ padding:"14px 20px 0" }}>
            <div style={{ fontWeight:800,fontSize:18,color:"#2C3E50",marginBottom:4 }}>Review listings</div>
            <div style={{ fontSize:12,color:"#bbb",marginBottom:10 }}>Swipe to propose trades — offers go to the Trades tab</div>
            <div style={{ fontSize:10,fontWeight:700,color:"#ccc",letterSpacing:1,marginBottom:8 }}>YOUR OFFER</div>
            <div style={{ display:"flex",gap:7,overflowX:"auto",paddingBottom:4 }}>
              {myTradeable.length === 0 ? (
                <div style={{ fontSize:12,color:"#aaa",padding:"8px 0" }}>List a figure for trade in <button type="button" onClick={()=>setTab("vault")} style={{ background:"none",border:"none",color:"#3A7BD5",fontWeight:700,cursor:"pointer",padding:0 }}>Vault</button></div>
              ) : myTradeable.map(fig=><div key={fig.id} onClick={()=>setSelectedOffer(fig)} style={{ flexShrink:0,background:selectedOffer?.id===fig.id?"#2C3E50":"#fff",borderRadius:14,padding:"7px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:7,border:"1.5px solid",transition:"all 0.15s",borderColor:selectedOffer?.id===fig.id?"#2C3E50":"#DCE6F0" }}><span style={{ fontSize:18 }}>{fig.image}</span><div><div style={{ fontSize:10,fontWeight:800,color:selectedOffer?.id===fig.id?"#fff":"#2C3E50",maxWidth:80,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{fig.name}</div><div style={{ fontSize:9,color:selectedOffer?.id===fig.id?"rgba(255,255,255,0.6)":"#bbb" }}>${fig.value}</div></div></div>)}
            </div>
          </div>
          <div style={{ flex:1,padding:"18px 20px 0" }}>
            {swipeCards.length===0?(
              <div style={{ textAlign:"center",padding:"80px 20px" }}><div style={{ fontSize:52,marginBottom:14 }}>🎉</div><div style={{ fontWeight:800,fontSize:18,color:"#2C3E50",marginBottom:6 }}>All swiped!</div><button onClick={()=>setTab("browse")} style={{ background:"#2C3E50",border:"none",borderRadius:14,padding:"10px 24px",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",marginTop:8 }}>Back to Browse</button></div>
            ):(
              <div style={{ position:"relative",height:510 }}>
                {visibleSwipeData.map((card,i)=><SwipeCard key={card.id} card={card} owner={card.owner} matchScore={card.matchScore} onSwipe={dir=>handleSwipe(dir,card.id)} isTop={i===visibleSwipeData.length-1} stackIndex={visibleSwipeData.length-1-i} onOpenVideo={() => { const e = getListingVideoEmbed(card.videoUrl); if (e) setListingVideoModal(e); }} />)}
              </div>
            )}
          </div>
          {swipeCards.length>0&&(
            <div style={{ padding:"10px 20px 18px",display:"flex",alignItems:"center",justifyContent:"center",gap:14 }}>
              <button onClick={()=>setTab("browse")} style={{ width:44,height:44,borderRadius:"50%",background:"#fff",border:"1.5px solid #eee",fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 10px rgba(0,0,0,0.07)" }}>☰</button>
              <button onClick={()=>swipeCards.length&&handleSwipe("no",swipeCards[0])} style={{ width:62,height:62,borderRadius:"50%",background:"#fff",border:"2px solid #4A90D9",fontSize:24,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 18px rgba(253,121,168,0.25)" }}>✕</button>
              <button onClick={()=>swipeCards.length&&handleSwipe("yes",swipeCards[0])} style={{ width:70,height:70,borderRadius:"50%",background:"linear-gradient(135deg,#00b894,#55efc4)",border:"none",fontSize:28,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 6px 22px rgba(0,184,148,0.4)" }}>🤝</button>
              <button onClick={()=>notify("⭐ Saved!")} style={{ width:44,height:44,borderRadius:"50%",background:"#fff",border:"1.5px solid #eee",fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 10px rgba(0,0,0,0.07)" }}>⭐</button>
            </div>
          )}
          <div style={{ padding:"0 20px 14px" }}>
            <div style={{ height:3,background:"#DCE6F0",borderRadius:4,overflow:"hidden" }}><div style={{ height:"100%",background:"linear-gradient(90deg,#4A90D9,#00b894)",borderRadius:4,width:`${((otherCards.length-swipeCards.length)/Math.max(otherCards.length,1))*100}%`,transition:"width 0.3s" }} /></div>
            <div style={{ textAlign:"center",fontSize:10,color:"#ccc",fontWeight:700,marginTop:5 }}>{otherCards.length-swipeCards.length} of {otherCards.length} viewed</div>
          </div>
        </div>
      )}

      {/* ── TRADES ── */}
      {tab==="trades" && (
        <div className="inhand-page" style={{ flex:1,overflowY:"auto",padding:"20px 20px 80px" }}>
          <div style={{ fontWeight:800,fontSize:18,color:"#2C3E50",marginBottom:4 }}>🤝 Trades</div>
          <div style={{ fontSize:12,color:"#888",marginBottom:16,lineHeight:1.5 }}>Manage swap proposals and trade history. Your collection lives in <strong>Vault</strong>; profile &amp; settings are under <strong>Account</strong>.</div>

          <div style={{ display:"flex",background:"#DCE6F0",borderRadius:12,padding:4,gap:2,marginBottom:16 }}>
            {[["proposed","Proposed"],["history","History"]].map(([id,label])=>(
              <button key={id} type="button" onClick={()=>setTradesView(id)} style={{ flex:1,background:tradesView===id?"#fff":"transparent",border:"none",borderRadius:8,padding:"8px 4px",fontSize:11,fontWeight:tradesView===id?800:600,color:tradesView===id?"#2C3E50":"#aaa",cursor:"pointer" }}>{label}</button>
            ))}
          </div>

          {tradesView === "proposed" && (
            <>
              <div style={{ background:"#fff",borderRadius:16,padding:"14px 16px",border:"1px solid #E4EBF2",marginBottom:16 }}>
                <div style={{ fontSize:10,fontWeight:700,color:"#bbb",letterSpacing:1,marginBottom:8 }}>FIGURE YOU&apos;RE OFFERING</div>
                {myTradeable.length === 0 ? (
                  <div style={{ fontSize:12,color:"#888" }}>No trade listings yet. Open <button type="button" onClick={()=>setTab("vault")} style={{ background:"none",border:"none",color:"#3A7BD5",fontWeight:700,cursor:"pointer",padding:0 }}>Vault</button> and enable ⇄ Trade on a figure.</div>
                ) : (
                  <div style={{ display:"flex",gap:7,overflowX:"auto" }}>
                    {myTradeable.map(fig=><div key={fig.id} onClick={()=>setSelectedOffer(fig)} style={{ flexShrink:0,background:selectedOffer?.id===fig.id?"#2C3E50":"#EEF2F7",borderRadius:12,padding:"7px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:7,border:"1.5px solid",borderColor:selectedOffer?.id===fig.id?"#2C3E50":"transparent" }}><span style={{ fontSize:18 }}>{fig.image}</span><div><div style={{ fontSize:10,fontWeight:800,color:selectedOffer?.id===fig.id?"#fff":"#2C3E50" }}>{fig.name}</div><div style={{ fontSize:9,color:selectedOffer?.id===fig.id?"rgba(255,255,255,0.6)":"#888" }}>${fig.value}</div></div></div>)}
                  </div>
                )}
              </div>

              {liked.length===0?(
                <div style={{ textAlign:"center",padding:"48px 20px",background:"#fff",borderRadius:20,border:"1px dashed #DCE6F0" }}>
                  <div style={{ fontSize:48,marginBottom:12 }}>🤝</div>
                  <div style={{ fontWeight:700,fontSize:15,color:"#2C3E50",marginBottom:6 }}>No proposed trades</div>
                  <div style={{ fontSize:12,color:"#aaa",marginBottom:16 }}>Browse listings and swipe right to add proposals here.</div>
                  <button type="button" onClick={()=>setTab("browse")} style={{ background:"#2C3E50",border:"none",borderRadius:14,padding:"10px 22px",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer" }}>Browse Listings</button>
                </div>
              ):liked.map(card=>{
            const {from}=lc(card.line);
            const diff = selectedOffer ? card.value - selectedOffer.value : 0;
            const iOwe = diff > 0;
            const isEven = Math.abs(diff) < 5;
            return (
              <div key={card.id} style={{ background:"#fff",borderRadius:20,padding:"16px",boxShadow:"0 2px 14px rgba(0,0,0,0.06)",border:"1px solid #E4EBF2",marginBottom:12 }}>
                {/* Their figure */}
                <div style={{ display:"flex",gap:12,alignItems:"center",marginBottom:12 }}>
                  <FigureImage card={card} size={58} borderRadius={14} onVideoOpen={() => { const e = getListingVideoEmbed(card.videoUrl); if (e) setListingVideoModal(e); }} />
                  <div style={{ flex:1 }}><div style={{ fontWeight:800,fontSize:14,color:"#2C3E50" }}>{card.name}</div><div style={{ fontSize:11,color:"#aaa" }}>{card.line} · {condLabel(card.isNew)}</div><div style={{ fontWeight:800,fontSize:14,color:from,marginTop:3 }}>${card.value}</div></div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:22 }}>{card.owner?.avatar}</div>
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4, marginTop:2 }}>
                      <div style={{ fontSize:10,color:"#bbb",fontWeight:700 }}>{card.owner?.username}</div>
                      {card.owner?.verified && <VerifiedInHandBadge compact />}
                    </div>
                  </div>
                </div>

                {/* Your offer */}
                {selectedOffer && (
                  <div style={{ background:"#f9f9f9",borderRadius:12,padding:"9px 12px",marginBottom:10,display:"flex",alignItems:"center",gap:8 }}>
                    <span style={{ fontSize:9,fontWeight:700,color:"#bbb" }}>YOU OFFER</span>
                    <span style={{ fontSize:18 }}>{selectedOffer.image}</span>
                    <span style={{ fontWeight:700,fontSize:12,color:"#2C3E50" }}>{selectedOffer.name}</span>
                    <span style={{ fontWeight:800,fontSize:12,color:"#4A90D9",marginLeft:"auto" }}>${selectedOffer.value}</span>
                  </div>
                )}

                {/* Differential banner */}
                {selectedOffer && (
                  <div style={{ background: isEven?"#f0fff8": iOwe?"#fff8e6":"#EAF1FA", borderRadius:10, padding:"8px 12px", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                    <span style={{ fontSize:11, fontWeight:700, color: isEven?"#00b894": iOwe?"#f0932b":"#3A7BD5" }}>
                      {isEven ? "⚖️ Even trade!" : iOwe ? `⚠️ You owe $${Math.abs(diff)} sweetener` : `💰 You'd receive $${Math.abs(diff)} sweetener`}
                    </span>
                    <span style={{ fontSize:10, color:"#bbb" }}>
                      ${card.value} vs ${selectedOffer.value}
                    </span>
                  </div>
                )}
                {/* Trade fee notice */}
                <div style={{ background:"#EAF1FA", borderRadius:8, padding:"6px 12px", marginBottom:12, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <span style={{ fontSize:10, color:"#3A7BD5", fontWeight:700 }}>💳 Trade fee: $2.00 per party</span>
                  <span style={{ fontSize:10, color:"#aaa" }}>Charged to each trader</span>
                </div>

                <div style={{ display:"flex",gap:8 }}>
                  <button onClick={()=>openThread(card.owner?.id||card.ownerId, card)} style={{ flex:1,background:"#EEF2F7",border:"none",borderRadius:12,padding:"9px",fontWeight:700,fontSize:12,color:"#555",cursor:"pointer" }}>💬 Message</button>
                  <button
                    onClick={()=> selectedOffer ? setSweetenerTrade({ theirCard: card, myFigure: selectedOffer }) : notify("Pick a figure to offer first")}
                    style={{ flex:2,background: isEven?"#2C3E50":`linear-gradient(135deg,${iOwe?"#f9ca24,#f0932b":"#3A7BD5,#5B8DD9"})`,border:"none",borderRadius:12,padding:"9px",fontWeight:800,fontSize:12,color:"#fff",cursor:"pointer" }}
                  >
                    {isEven ? "Confirm Trade 🤝" : iOwe ? `Pay $${Math.abs(diff)} & Trade 💛` : `Receive $${Math.abs(diff)} & Trade 💜`}
                  </button>
                </div>
              </div>
            );
          })}
            </>
          )}

          {tradesView === "history" && (
            myTradeTxns.length === 0 ? (
              <div style={{ textAlign:"center",padding:"48px 20px",background:"#fff",borderRadius:20,border:"1px dashed #DCE6F0" }}>
                <div style={{ fontSize:48,marginBottom:12 }}>📋</div>
                <div style={{ fontWeight:700,fontSize:15,color:"#2C3E50" }}>No completed trades yet</div>
                <div style={{ fontSize:12,color:"#aaa",marginTop:8 }}>Confirmed swaps and sweeteners appear here.</div>
              </div>
            ) : myTradeTxns.map((txn) => {
              const otherId = txn.buyerId === activeUserId ? txn.sellerId : txn.buyerId;
              const other = getUser(otherId);
              return (
                <div key={txn.id} style={{ background:"#fff",borderRadius:16,padding:"14px 16px",border:"1px solid #E4EBF2",marginBottom:10 }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10 }}>
                    <div>
                      <div style={{ fontWeight:800,fontSize:14,color:"#2C3E50" }}>{txn.cardName || "Trade"}</div>
                      <div style={{ fontSize:11,color:"#aaa",marginTop:4 }}>with {other?.username || "collector"} · {txn.date}</div>
                      <div style={{ fontSize:10,color:"#888",marginTop:4 }}>{txn.type === "sweetener" ? "Sweetener payment" : "Figure swap"} · {txn.status}</div>
                    </div>
                    <div style={{ fontWeight:800,fontSize:14,color:txn.type === "sweetener" ? "#f0932b" : "#3A7BD5" }}>
                      {txn.type === "sweetener" ? `$${fmt(txn.amount)}` : "⇄ Trade"}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── VAULT ── */}
      {tab==="vault" && (
        <div style={{ flex:1,overflowY:"auto",padding:"20px 20px 80px" }}>
          {/* Inline photo editor modal */}
          {editingPhotos && (() => {
            const fig = myCards.find(c=>c.id===editingPhotos);
            if (!fig) return null;
            return (
              <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:600,display:"flex",alignItems:"flex-end",justifyContent:"center" }}>
                <div style={{ background:"#fff",borderRadius:"28px 28px 0 0",padding:"24px 20px 40px",width:"100%",maxWidth:430 }}>
                  <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}>
                    <div>
                      <div style={{ fontWeight:800,fontSize:17,color:"#2C3E50" }}>Edit Photos</div>
                      <div style={{ fontSize:11,color:"#aaa",marginTop:2 }}>{fig.name}</div>
                    </div>
                    <button onClick={()=>setEditingPhotos(null)} style={{ background:"#E4EBF2",border:"none",borderRadius:"50%",width:32,height:32,fontSize:16,cursor:"pointer" }}>✕</button>
                  </div>
                  <PhotoPicker
                    photos={fig.photos||[]}
                    onChange={newPhotos => setDb(d=>({...d, cards:d.cards.map(c=>c.id===fig.id?{...c,photos:newPhotos}:c)}))}
                    maxPhotos={4}
                  />
                  <div style={{ marginTop:16 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:"#555", marginBottom:6 }}>Optional short video</div>
                    <div style={{ fontSize:10, color:"#aaa", marginBottom:8, lineHeight:1.4 }}>YouTube, Vimeo, or a direct link to an .mp4 or .webm file.</div>
                    <input value={vaultVideoDraft} onChange={e=>setVaultVideoDraft(e.target.value)} placeholder="https://…" style={IS} />
                    <Btn onClick={()=>handleSaveListingVideo(fig.id)} style={{ background:"#3A7BD5", color:"#fff", width:"100%", marginTop:10 }}>Save video link</Btn>
                  </div>
                  <Btn onClick={()=>handleSaveCardPhotos(fig.id, fig.photos||[])} style={{ background:"#2C3E50",color:"#fff",width:"100%",marginTop:14 }}>Save Photos</Btn>
                </div>
              </div>
            );
          })()}

          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4 }}>
            <div>
              <div style={{ fontWeight:800,fontSize:18,color:"#2C3E50" }}>🗃️ My Vault</div>
              <div style={{ fontSize:12,color:"#888",marginTop:4 }}>Your collection — photos, listing status & inventory</div>
            </div>
            <button type="button" onClick={()=>setShowAddCard(true)} style={{ background:"#2C3E50",border:"none",borderRadius:10,padding:"7px 14px",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer" }}>+ Add</button>
          </div>
          <div style={{ fontSize:12,color:"#bbb",marginBottom:12 }}>Total value: <strong style={{ color:"#2C3E50" }}>${myCards.reduce((s,f)=>s+f.value,0).toLocaleString()}</strong> · {myCards.length} figures</div>

          <div style={{ display:"flex",gap:6,overflowX:"auto",marginBottom:16,paddingBottom:2 }}>
            {[["all","All"],["trade","For trade"],["sale","For sale"],["private","Private"]].map(([id,label])=>(
              <button key={id} type="button" onClick={()=>setVaultFilter(id)} style={{ flexShrink:0,background:vaultFilter===id?"#2C3E50":"#EEF2F7",border:"none",borderRadius:20,padding:"6px 14px",fontSize:11,fontWeight:700,color:vaultFilter===id?"#fff":"#666",cursor:"pointer" }}>{label}</button>
            ))}
          </div>

          {/* Empty state */}
          {myCards.length === 0 && (
            <div style={{ textAlign:"center", padding:"48px 20px", background:"#fff", borderRadius:24, border:"2px dashed #DCE6F0" }}>
              <div style={{ fontSize:64, marginBottom:16 }}>🗃️</div>
              <div style={{ fontWeight:800, fontSize:20, color:"#2C3E50", marginBottom:8 }}>Your vault is empty</div>
              <div style={{ fontSize:13, color:"#aaa", lineHeight:1.6, marginBottom:24 }}>Add your first figure to start buying, selling and trading with collectors worldwide.</div>
              <button onClick={()=>setShowAddCard(true)} style={{ background:"linear-gradient(135deg,#4A90D9,#f0932b)", border:"none", borderRadius:16, padding:"14px 32px", color:"#fff", fontWeight:800, fontSize:15, cursor:"pointer", boxShadow:"0 4px 16px rgba(253,121,168,0.4)" }}>
                + Add Your First Figure
              </button>
              <div style={{ marginTop:20, display:"flex", justifyContent:"center", gap:16 }}>
                {["📷 Add photos","💰 Set your price","⇄ Trade or sell"].map((t,i)=>(
                  <div key={i} style={{ fontSize:11, color:"#bbb", fontWeight:600 }}>{t}</div>
                ))}
              </div>
            </div>
          )}

          {vaultFiltered.length === 0 && myCards.length > 0 ? (
            <div style={{ textAlign:"center",padding:"32px 16px",color:"#aaa",fontSize:13 }}>No figures in this filter.</div>
          ) : vaultFiltered.map(fig=>{ const {from}=lc(fig.line); return (
            <div key={fig.id} style={{ background:"#fff",borderRadius:18,padding:"14px 16px",boxShadow:"0 2px 10px rgba(0,0,0,0.05)",border:"1px solid #E4EBF2",marginBottom:10,display:"flex",gap:14,alignItems:"center" }}>
              <div style={{ position:"relative", flexShrink:0 }}>
                <FigureImage card={fig} size={56} borderRadius={14} onClick={fig.photos?.length>0?()=>setPhotoViewer({photos:fig.photos,startIdx:0}):undefined} onVideoOpen={() => { const e = getListingVideoEmbed(fig.videoUrl); if (e) setListingVideoModal(e); }} />
                {fig.wantsTrade&&<div style={{ position:"absolute",top:-4,right:-4,width:12,height:12,background:"#00b894",borderRadius:"50%",border:"2px solid #fff" }} />}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:800,fontSize:14,color:"#2C3E50" }}>{fig.name}</div>
                <div style={{ fontSize:11,color:"#bbb",marginTop:1 }}>{fig.line}</div>
                {fig.description && <div style={{ fontSize:11,color:"#888",marginTop:3,lineHeight:1.4 }}>{fig.description}</div>}
                <div style={{ display:"flex",gap:6,marginTop:5 }}><span style={{ fontSize:10,fontWeight:800,background:condBg(fig.isNew),color:condColor(fig.isNew),borderRadius:6,padding:"2px 8px" }}>{condLabel(fig.isNew)}</span><span style={{ fontWeight:800,fontSize:13,color:from }}>${fig.value}</span></div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"stretch", gap:6, minWidth:72 }}>
                <button type="button" onClick={()=>handleToggleListing(fig.id,"wantsTrade")} style={{ background:fig.wantsTrade?"#e8fff6":"#EEF2F7", border:"none", borderRadius:8, padding:"5px 6px", fontSize:9, fontWeight:700, color:fig.wantsTrade?"#00b894":"#888", cursor:"pointer" }}>{fig.wantsTrade?"⇄ Trade on":"⇄ Trade off"}</button>
                <button type="button" onClick={()=>handleToggleListing(fig.id,"wantsBuy")} style={{ background:fig.wantsBuy?"#fff8e6":"#EEF2F7", border:"none", borderRadius:8, padding:"5px 6px", fontSize:9, fontWeight:700, color:fig.wantsBuy?"#f0932b":"#888", cursor:"pointer" }}>{fig.wantsBuy?"💰 Sale on":"💰 Sale off"}</button>
                <button type="button" onClick={()=>setEditingPhotos(fig.id)} style={{ background:"#EAF1FA", border:"none", borderRadius:8, padding:"4px 8px", fontSize:9, fontWeight:700, color:"#3A7BD5", cursor:"pointer", whiteSpace:"nowrap" }}>
                  📷 {fig.photos?.length||0}
                </button>
                <button onClick={()=>setShareCard(fig)} style={{ background:"#EEF2F7", border:"none", borderRadius:8, padding:"4px 8px", fontSize:9, fontWeight:700, color:"#555", cursor:"pointer" }}>
                  ↗️
                </button>
              </div>
            </div>
          );})}
        </div>
      )}

      {/* ── DB ── */}
      {tab==="db" && (
        <div style={{ flex:1,overflowY:"auto",padding:"20px 20px 90px" }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}>
            <div style={{ display:"flex",alignItems:"center",gap:10 }}>
              <button onClick={()=>setTab("account")} style={{ background:"#E4EBF2",border:"none",borderRadius:10,padding:"6px 12px",fontSize:12,fontWeight:700,color:"#555",cursor:"pointer" }}>← Account</button>
              <div style={{ fontWeight:800,fontSize:18,color:"#2C3E50" }}>🛡️ Admin Dashboard</div>
            </div>
            <button
              type="button"
              onClick={() => {
                if (supabase) reloadFromSupabase();
                else {
                  setDb({ users:SEED_USERS,cards:SEED_CARDS,transactions:SEED_TRANSACTIONS,shipments:SEED_SHIPMENTS,disputes:SEED_DISPUTES,ratings:SEED_RATINGS,messages:SEED_MESSAGES,notifications:SEED_NOTIFICATIONS });
                  notify("🔄 Reset");
                }
              }}
              style={{ background:"#fff0f0",border:"none",borderRadius:10,padding:"6px 12px",fontSize:11,fontWeight:700,color:"#ff6b6b",cursor:"pointer" }}
            >{supabase ? "Reload from cloud" : "Reset"}</button>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:18 }}>
            {[["👥",db.users.length,"Users"],["🤖",db.cards.length,"Figures"],["💸",db.transactions.length,"Txns"],["🚨",(db.disputes||[]).filter(d=>d.status==="open").length,"Disputes"]].map(([icon,val,label])=>(
              <div key={label} style={{ background:"#fff",borderRadius:14,padding:"12px 8px",textAlign:"center",boxShadow:"0 2px 10px rgba(0,0,0,0.05)",border:"1px solid #E4EBF2" }}>
                <div style={{ fontSize:20 }}>{icon}</div><div style={{ fontWeight:900,fontSize:18,color:"#2C3E50",lineHeight:1.2 }}>{val}</div><div style={{ fontSize:9,color:"#bbb",fontWeight:700 }}>{label}</div>
              </div>
            ))}
          </div>
          <div style={{ display:"flex",background:"#DCE6F0",borderRadius:12,padding:4,gap:2,marginBottom:16 }}>
            {[["users","👥 Users"],["cards","🤖 Figures"],["txns","💸 Txns"],["disputes","🚨 Disputes"]].map(([id,label])=>(
              <button key={id} onClick={()=>setAdminView(id)} style={{ flex:1,background:adminView===id?"#fff":"transparent",border:"none",borderRadius:8,padding:"7px 2px",fontSize:10,fontWeight:adminView===id?800:600,color:adminView===id?"#2C3E50":"#aaa",cursor:"pointer" }}>{label}</button>
            ))}
          </div>
          {adminView==="users" && (
            <div>
              <div style={{ display:"flex",justifyContent:"flex-end",marginBottom:12 }}>
                <button type="button" onClick={()=>setShowAddUser(true)} style={{ background:"#2C3E50",border:"none",borderRadius:10,padding:"7px 14px",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer" }}>+ Add User</button>
              </div>
              {db.users.map(user=>{ const uc=db.cards.filter(c=>c.ownerId===user.id); return (
                <div key={user.id} style={{ background:"#fff",borderRadius:16,padding:"14px",boxShadow:"0 2px 10px rgba(0,0,0,0.05)",border:"1px solid #E4EBF2",marginBottom:10 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:12 }}>
                    <div style={{ width:44,height:44,borderRadius:"50%",background:"#E4EBF2",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0 }}>{user.avatar}</div>
                    <div style={{ flex:1,minWidth:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                        <div style={{ fontWeight:800,fontSize:14,color:"#2C3E50" }}>{user.username}</div>
                        {user.verified && <VerifiedInHandBadge compact />}
                      </div>
                      <div style={{ fontSize:10,color:"#bbb",marginTop:1 }}>{user.location} · {user.joined}</div>
                      <div style={{ display:"flex",gap:6,marginTop:4,flexWrap:"wrap" }}>
                        <span style={{ fontSize:10,background:"#fff8e6",color:"#f9ca24",borderRadius:6,padding:"1px 7px",fontWeight:700 }}>⭐ {user.rating}</span>
                        <span style={{ fontSize:10,background:"#E4EBF2",color:"#555",borderRadius:6,padding:"1px 7px",fontWeight:700 }}>{user.tradesCompleted} trades</span>
                        <span style={{ fontSize:10,background:"#e8fff6",color:"#00b894",borderRadius:6,padding:"1px 7px",fontWeight:700 }}>{uc.length} figures</span>
                        <span style={{ fontSize:10,background:"#f0fff8",color:"#00b894",borderRadius:6,padding:"1px 7px",fontWeight:700 }}>💰 ${fmt(user.walletBalance||0)}</span>
                        {user.flagCount>0 && <span style={{ fontSize:10,background:"#fff0f0",color:"#ff6b6b",borderRadius:6,padding:"1px 7px",fontWeight:700 }}>🚫 {user.flagCount} flags</span>}
                      </div>
                    </div>
                    <div style={{ display:"flex",flexDirection:"column",gap:6,flexShrink:0 }}>
                      <button type="button" onClick={()=>handleAdminToggleVerified(user.id, !user.verified)} style={{ background:user.verified?"#e8fff6":"#EEF2F7",border:"none",borderRadius:8,padding:"5px 10px",fontSize:10,fontWeight:700,color:user.verified?"#00b894":"#555",cursor:"pointer" }}>{user.verified?"✓ Verified":"Mark verified"}</button>
                      {user.id!==activeUserId && (
                        <button type="button" onClick={()=>handleAdminDeleteUser(user.id)} style={{ background:"#fff0f0",border:"none",borderRadius:8,padding:"5px 10px",fontSize:11,color:"#ff6b6b",cursor:"pointer",fontWeight:700 }}>del</button>
                      )}
                    </div>
                  </div>
                </div>
              );})}
            </div>
          )}
          {adminView==="cards" && (
            <div>
              <div style={{ display:"flex",justifyContent:"flex-end",marginBottom:12 }}><button onClick={()=>setShowAddCard(true)} style={{ background:"#2C3E50",border:"none",borderRadius:10,padding:"7px 14px",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer" }}>+ Add Card</button></div>
              {db.cards.map(card=>{ const {from,light}=lc(card.line); const owner=getUser(card.ownerId); return (
                <div key={card.id} style={{ background:"#fff",borderRadius:16,padding:"12px 14px",boxShadow:"0 2px 10px rgba(0,0,0,0.05)",border:"1px solid #E4EBF2",marginBottom:8,display:"flex",alignItems:"center",gap:12 }}>
                  <div style={{ width:48,height:48,borderRadius:12,background:light,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,flexShrink:0 }}>{card.image}</div>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontWeight:700,fontSize:13,color:"#2C3E50" }}>{card.name}</div>
                    <div style={{ fontSize:10,color:"#bbb" }}>{card.line} · {condLabel(card.isNew)} · <span style={{ color:from,fontWeight:800 }}>${card.value}</span></div>
                    <div style={{ display:"flex",gap:4,marginTop:4,flexWrap:"wrap",alignItems:"center" }}>
                      <span style={{ fontSize:9,background:"#E4EBF2",color:"#888",borderRadius:5,padding:"1px 6px",fontWeight:700, display:"inline-flex", alignItems:"center", gap:4 }}>{owner?.avatar} {owner?.username}{owner?.verified && <VerifiedInHandBadge compact />}</span>
                      {card.wantsTrade&&<span style={{ fontSize:9,background:"#e8fff6",color:"#00b894",borderRadius:5,padding:"1px 6px",fontWeight:700 }}>⇄</span>}
                      {card.wantsBuy&&<span style={{ fontSize:9,background:"#fff8e6",color:"#f0932b",borderRadius:5,padding:"1px 6px",fontWeight:700 }}>💰</span>}
                    </div>
                  </div>
                  <button onClick={()=>handleDeleteCard(card.id)} style={{ background:"#fff0f0",border:"none",borderRadius:8,padding:"5px 10px",fontSize:11,color:"#ff6b6b",cursor:"pointer",fontWeight:700,flexShrink:0 }}>del</button>
                </div>
              );})}
            </div>
          )}
          {adminView==="txns" && (
            <div>
              {db.transactions.length===0?<div style={{ textAlign:"center",padding:"40px 0",color:"#ccc" }}>No transactions</div>
                :db.transactions.map(txn=>{ const buyer=getUser(txn.buyerId); const seller=getUser(txn.sellerId); const statusColor=txn.status==="completed"?"#00b894":txn.status==="disputed"?"#ff6b6b":txn.status==="in_escrow"?"#3A7BD5":"#f9ca24"; return (
                  <div key={txn.id} style={{ background:"#fff",borderRadius:16,padding:"12px 14px",boxShadow:"0 2px 10px rgba(0,0,0,0.05)",border:"1px solid #E4EBF2",marginBottom:8 }}>
                    <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6 }}>
                      <div style={{ fontWeight:700,fontSize:13,color:"#2C3E50",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{txn.cardName}</div>
                      <span style={{ fontSize:9,background:`${statusColor}18`,color:statusColor,borderRadius:5,padding:"2px 8px",fontWeight:700,flexShrink:0,marginLeft:8 }}>{txn.status}</span>
                    </div>
                    <div style={{ display:"flex",gap:8,flexWrap:"wrap",alignItems:"center" }}>
                      <span style={{ fontSize:10,color:"#aaa", display:"inline-flex", alignItems:"center", gap:4 }}>{buyer?.avatar} {buyer?.username}{buyer?.verified && <VerifiedInHandBadge compact />}</span>
                      <span style={{ fontSize:10,color:"#ccc" }}>→</span>
                      <span style={{ fontSize:10,color:"#aaa", display:"inline-flex", alignItems:"center", gap:4 }}>{seller?.avatar} {seller?.username}{seller?.verified && <VerifiedInHandBadge compact />}</span>
                      <span style={{ fontSize:11,fontWeight:800,color:"#2C3E50",marginLeft:"auto" }}>${txn.amount}</span>
                      <span style={{ fontSize:10,color:"#ccc" }}>{txn.date}</span>
                    </div>
                  </div>
              );})}
            </div>
          )}

          {/* ── DISPUTES ADMIN ── */}
          {adminView==="disputes" && (
            <div>
              {(db.disputes||[]).length===0
                ? <div style={{ textAlign:"center",padding:"40px 0",color:"#ccc" }}><div style={{ fontSize:40,marginBottom:10 }}>✅</div><div style={{ fontWeight:700 }}>No disputes</div></div>
                : (db.disputes||[]).map(d => {
                  const raiser = getUser(d.raisedBy);
                  const against = getUser(d.againstUserId);
                  const statusColor = d.status==="open"?"#ff6b6b":d.status==="resolved"?"#00b894":"#f9ca24";
                  const reasonLabel = DISPUTE_REASONS?.find(r=>r.id===d.reason)?.label || d.reason;
                  const kind = d.disputeType === "trade" ? "trade" : "purchase";
                  return (
                    <div key={d.id} style={{ background:"#fff",borderRadius:16,padding:"14px",boxShadow:"0 2px 10px rgba(0,0,0,0.05)",border:`1px solid ${statusColor}22`,marginBottom:10 }}>
                      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,gap:8,flexWrap:"wrap" }}>
                        <div style={{ fontWeight:800,fontSize:13,color:"#2C3E50",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{d.figureName}</div>
                        <div style={{ display:"flex",alignItems:"center",gap:6,flexShrink:0 }}>
                          <span style={{ fontSize:8,fontWeight:800,background:kind==="trade"?"#EAF1FA":"#f0fff8",color:kind==="trade"?"#3A7BD5":"#00b894",borderRadius:6,padding:"2px 8px",textTransform:"uppercase" }}>{kind}</span>
                          <span style={{ fontSize:9,background:`${statusColor}18`,color:statusColor,borderRadius:6,padding:"2px 8px",fontWeight:800 }}>{d.status.toUpperCase()}</span>
                        </div>
                      </div>
                      <div style={{ fontSize:11,color:"#555",marginBottom:6 }}><strong>{reasonLabel}</strong></div>
                      <div style={{ fontSize:11,color:"#aaa",marginBottom:10,lineHeight:1.4 }}>{d.detail}</div>
                      <div style={{ display:"flex",gap:8,alignItems:"center",marginBottom:d.status==="open"?10:0 }}>
                        <span style={{ fontSize:11,color:"#888" }}>{raiser?.avatar} {raiser?.username}</span>
                        <span style={{ fontSize:10,color:"#ccc" }}>vs</span>
                        <span style={{ fontSize:11,color:"#888" }}>{against?.avatar} {against?.username}</span>
                        <span style={{ fontSize:10,color:"#ccc",marginLeft:"auto" }}>{d.raisedAt}</span>
                      </div>
                      {d.status==="open" && (
                        <div style={{ display:"flex",gap:6,flexDirection:"column" }}>
                          {d.reason === "damaged" && (
                            <div style={{ background:"#fff8e6",border:"1.5px solid #f9ca24",borderRadius:10,padding:"10px 12px",marginBottom:4 }}>
                              <div style={{ fontWeight:700,fontSize:11,color:"#f0932b",marginBottom:4 }}>💔 Damage Claim Protocol</div>
                              <div style={{ fontSize:10,color:"#888",lineHeight:1.5,marginBottom:6 }}>1. Ask buyer to submit photos of figure + packaging + label<br/>2. Confirm damage is transit-related (not pre-existing)<br/>3. Seller files USPS claim at <strong>usps.com/help/claims.htm</strong><br/>4. USPS reimburses seller within 5–10 business days</div>
                              <button type="button" onClick={() => handleAdminResolveDispute(d, "usps_claim")} style={{ width:"100%",background:"#fff8e6",border:"2px solid #f9ca24",borderRadius:8,padding:"7px",fontWeight:700,fontSize:11,color:"#f0932b",cursor:"pointer" }}>📮 Resolve: USPS Insurance Claim</button>
                            </div>
                          )}
                          <div style={{ display:"flex",gap:6 }}>
                            <button type="button" onClick={() => handleAdminResolveDispute(d, "refund_full")} style={{ flex:1,background:"#f0fff8",border:"2px solid #00b894",borderRadius:10,padding:"7px",fontWeight:700,fontSize:11,color:"#00b894",cursor:"pointer" }}>✅ Full Refund</button>
                            <button type="button" onClick={() => handleAdminResolveDispute(d, "no_action")} style={{ flex:1,background:"#fff0f0",border:"2px solid #ff6b6b",borderRadius:10,padding:"7px",fontWeight:700,fontSize:11,color:"#ff6b6b",cursor:"pointer" }}>❌ Reject</button>
                          </div>
                        </div>
                      )}
                      {d.status==="resolved" && d.adminNote && (
                        <div style={{ background:"#f9f9f9",borderRadius:10,padding:"8px 10px",fontSize:11,color:"#888" }}>Admin: {d.adminNote}</div>
                      )}
                    </div>
                  );
                })
              }
            </div>
          )}
        </div>
      )}

      {/* ── FEES ── */}
      {tab==="fees" && (
        <div style={{ flex:1,overflowY:"auto",padding:"20px 20px 90px" }}>
          <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:16 }}>
            <button onClick={()=>setTab("account")} style={{ background:"#E4EBF2",border:"none",borderRadius:10,padding:"6px 12px",fontSize:12,fontWeight:700,color:"#555",cursor:"pointer" }}>← Account</button>
            <div style={{ fontWeight:800,fontSize:18,color:"#2C3E50" }}>💸 Fees & Pricing</div>
          </div>

          {/* Hero */}
          <div style={{ background:"linear-gradient(135deg,#2C3E50,#3A7BD5)",borderRadius:20,padding:"24px",marginBottom:20,textAlign:"center" }}>
            <div style={{ fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.6)",letterSpacing:1.5,marginBottom:8 }}>IN HAND PROMISE</div>
            <div style={{ fontWeight:800,fontSize:18,color:"#fff",lineHeight:1.4 }}>Simple, transparent fees.<br/>No hidden charges. Ever.</div>
          </div>

          {/* Sales fees */}
          <div style={{ fontWeight:700,fontSize:12,color:"#aaa",letterSpacing:1,marginBottom:10 }}>BUYING & SELLING</div>
          <div style={{ background:"#fff",borderRadius:18,overflow:"hidden",boxShadow:"0 2px 10px rgba(0,0,0,0.05)",border:"1px solid #E4EBF2",marginBottom:20 }}>
            {[
              { icon:"💰", title:"Sale — In Hand Fee", value:`${(PLATFORM_FEE*100).toFixed(0)}%`, sub:"Deducted from seller's payout on every sale. Buyer pays listed price.", color:"#00b894" },
              { icon:"📦", title:"Shipping — Buyer Pays", value:"USPS rates", sub:"Calculated automatically by item value. Small/Medium/Large flat rate box.", color:"#3A7BD5" },
              { icon:"🔒", title:"Escrow Protection", value:"Free", sub:"Payment held safely until delivery confirmed. Auto-releases 7 days after delivery. Dispute window is 7 days.", color:"#00b894" },
              { icon:"🛡️", title:"USPS Insurance",      value:"Included", sub:`First $100 covered free by USPS. Items over $100 get additional insurance added automatically to the label cost.`, color:"#3A7BD5" },
            ].map((item,i,arr)=>(
              <div key={item.title} style={{ padding:"16px",borderBottom:i<arr.length-1?"1px solid #f0f0f0":"none" }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:5 }}>
                  <div style={{ display:"flex",gap:10,alignItems:"center" }}>
                    <span style={{ fontSize:22 }}>{item.icon}</span>
                    <div style={{ fontWeight:700,fontSize:13,color:"#2C3E50" }}>{item.title}</div>
                  </div>
                  <div style={{ fontWeight:900,fontSize:16,color:item.color,flexShrink:0,marginLeft:8 }}>{item.value}</div>
                </div>
                <div style={{ fontSize:11,color:"#aaa",lineHeight:1.5,paddingLeft:32 }}>{item.sub}</div>
              </div>
            ))}
          </div>

          {/* Payout example */}
          <div style={{ background:"#f0fff8",border:"1.5px solid #00b89433",borderRadius:16,padding:"16px",marginBottom:20 }}>
            <div style={{ fontWeight:700,fontSize:13,color:"#00b894",marginBottom:12 }}>📊 Sale Example — $220 figure</div>
            {[
              ["Buyer pays",                          `$${fmt(220 + 220*PLATFORM_FEE + 14.65)}`],
              ["  Item price",                        "$220.00"],
              [`  In Hand fee (${(PLATFORM_FEE*100).toFixed(0)}%)`,`-$${fmt(220*PLATFORM_FEE)}`],
              ["  USPS Ground shipping",              "$14.65"],
              ["Seller receives",                     `$${fmt(220*(1-PLATFORM_FEE))}`],
            ].map(([l,v],i)=>(
              <div key={l} style={{ display:"flex",justifyContent:"space-between",marginBottom:i===0||i===3?8:5,paddingTop:i===3?8:0,borderTop:i===3?"1px solid #00b89433":"none" }}>
                <span style={{ fontSize:i===0||i===3?13:11,color:i===0||i===3?"#2C3E50":"#888",fontWeight:i===0||i===3?800:400 }}>{l}</span>
                <span style={{ fontSize:i===0||i===3?14:11,color:i===3?"#00b894":"#555",fontWeight:700 }}>{v}</span>
              </div>
            ))}
          </div>

          {/* Trade fees */}
          <div style={{ fontWeight:700,fontSize:12,color:"#aaa",letterSpacing:1,marginBottom:10 }}>TRADING</div>
          <div style={{ background:"#fff",borderRadius:18,overflow:"hidden",boxShadow:"0 2px 10px rgba(0,0,0,0.05)",border:"1px solid #E4EBF2",marginBottom:20 }}>
            {[
              { icon:"🤝", title:"Trade Fee", value:`$${fmt(TRADE_FEE)} each`, sub:"Flat $2.00 per party per trade. Covers payment processing and platform costs.", color:"#3A7BD5" },
              { icon:"📦", title:"Shipping — Split", value:"Each ships theirs", sub:"Both traders ship their own figure. Each pays their own USPS Ground label.", color:"#3A7BD5" },
              { icon:"💛", title:"Sweetener Fee", value:`${(PLATFORM_FEE*100).toFixed(0)}% + $${fmt(TRADE_FEE)}`, sub:"If values differ, the party paying cash also pays 5% of the difference + the $2 trade fee.", color:"#f0932b" },
            ].map((item,i,arr)=>(
              <div key={item.title} style={{ padding:"16px",borderBottom:i<arr.length-1?"1px solid #f0f0f0":"none" }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:5 }}>
                  <div style={{ display:"flex",gap:10,alignItems:"center" }}>
                    <span style={{ fontSize:22 }}>{item.icon}</span>
                    <div style={{ fontWeight:700,fontSize:13,color:"#2C3E50" }}>{item.title}</div>
                  </div>
                  <div style={{ fontWeight:900,fontSize:14,color:item.color,flexShrink:0,marginLeft:8,textAlign:"right" }}>{item.value}</div>
                </div>
                <div style={{ fontSize:11,color:"#aaa",lineHeight:1.5,paddingLeft:32 }}>{item.sub}</div>
              </div>
            ))}
          </div>

          {/* Trade example */}
          <div style={{ background:"#EAF1FA",border:"1.5px solid #3A7BD533",borderRadius:16,padding:"16px",marginBottom:20 }}>
            <div style={{ fontWeight:700,fontSize:13,color:"#3A7BD5",marginBottom:12 }}>📊 Even Trade Example</div>
            {[
              ["You send your figure",   "Your USPS label cost"],
              ["They send their figure", "Their USPS label cost"],
              ["In Hand trade fee",      `$${fmt(TRADE_FEE)} each`],
              ["Total cost to you",      `$${fmt(TRADE_FEE)} + shipping label`],
            ].map(([l,v],i)=>(
              <div key={l} style={{ display:"flex",justifyContent:"space-between",marginBottom:i<3?6:0,paddingTop:i===3?8:0,borderTop:i===3?"1px solid #3A7BD533":"none" }}>
                <span style={{ fontSize:i===3?13:11,color:i===3?"#2C3E50":"#888",fontWeight:i===3?800:400 }}>{l}</span>
                <span style={{ fontSize:i===3?13:11,color:i===3?"#3A7BD5":"#555",fontWeight:700 }}>{v}</span>
              </div>
            ))}
          </div>

          {/* USPS rates reference */}
          <div style={{ fontWeight:700,fontSize:12,color:"#aaa",letterSpacing:1,marginBottom:10 }}>USPS GROUND RATES</div>
          <div style={{ background:"#fff",borderRadius:18,overflow:"hidden",boxShadow:"0 2px 10px rgba(0,0,0,0.05)",border:"1px solid #E4EBF2",marginBottom:20 }}>
            {USPS_RATES.map((r,i)=>(
              <div key={i} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"13px 16px",borderBottom:i<USPS_RATES.length-1?"1px solid #f0f0f0":"none" }}>
                <div>
                  <div style={{ fontWeight:700,fontSize:12,color:"#2C3E50" }}>{r.label}</div>
                  <div style={{ fontSize:10,color:"#aaa",marginTop:2 }}>Items up to ${i===USPS_RATES.length-1?"any value":r.maxValue}</div>
                </div>
                <div style={{ fontWeight:900,fontSize:15,color:"#3A7BD5" }}>${r.price.toFixed(2)}</div>
              </div>
            ))}
          </div>

          {/* Footer note */}
          <div style={{ background:"#f9f9f9",borderRadius:14,padding:"14px",fontSize:11,color:"#aaa",lineHeight:1.6,textAlign:"center" }}>
            Fees are subject to change. You'll always be notified before any changes take effect. In Hand never charges listing fees — you only pay when a transaction completes.
          </div>
        </div>
      )}

      {/* ── EMAIL TEMPLATES ── */}
      {tab==="emails" && <EmailTemplatesScreen onBack={()=>setTab("account")} />}

      {/* ── ACCOUNT ── */}
      {tab==="account" && (
        <div style={{ flex:1,overflowY:"auto",padding:"20px 20px 90px" }}>
          <div style={{ fontWeight:800,fontSize:18,color:"#2C3E50",marginBottom:4 }}>👤 Account</div>
          <div style={{ fontSize:12,color:"#888",marginBottom:16,lineHeight:1.5 }}>Profile, settings & shortcuts. Manage figures in <strong>Vault</strong>, swaps in <strong>Trades</strong>.</div>

          {/* Profile card */}
          <div style={{ background:"linear-gradient(135deg,#2C3E50,#2d3561)",borderRadius:24,padding:"24px",marginBottom:20,position:"relative",overflow:"hidden" }}>
            <div style={{ position:"absolute",top:-20,right:-20,width:120,height:120,borderRadius:"50%",background:"rgba(255,255,255,0.04)" }} />
            <div style={{ display:"flex",alignItems:"center",gap:14,marginBottom:18 }}>
              <div style={{ width:56,height:56,borderRadius:"50%",background:"rgba(255,255,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,border:"2px solid rgba(255,255,255,0.2)" }}>{myUser?.avatar}</div>
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                  <div style={{ fontWeight:800,fontSize:18,color:"#fff",lineHeight:1.1 }}>{myUser?.username}</div>
                  {myUser?.verified && <VerifiedInHandBadge compact />}
                </div>
                <div style={{ fontSize:11,color:"rgba(255,255,255,0.5)",marginTop:3 }}>{myUser?.location} · since {myUser?.joined}</div>
                <div style={{ display:"flex",gap:8,marginTop:6 }}>
                  <span style={{ fontSize:10,background:"rgba(255,255,255,0.1)",color:"#ffd93d",borderRadius:6,padding:"2px 8px",fontWeight:700 }}>⭐ {myUser?.rating}</span>
                  <span style={{ fontSize:10,background:"rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.7)",borderRadius:6,padding:"2px 8px",fontWeight:700 }}>{myUser?.tradesCompleted} trades</span>
                </div>
              </div>
            </div>
            {/* Wallet balance inline */}
            <div style={{ background:"rgba(255,255,255,0.08)",borderRadius:16,padding:"14px 16px",display:"flex",alignItems:"center",justifyContent:"space-between" }}>
              <div>
                <div style={{ fontSize:10,color:"rgba(255,255,255,0.5)",fontWeight:700,letterSpacing:1 }}>SALE EARNINGS</div>
                <div style={{ fontWeight:900,fontSize:26,color:"#fff",letterSpacing:-0.5 }}>${fmt(myUser?.walletBalance||0)}</div>
              </div>
              <button onClick={()=>setTab("wallet")} style={{ background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:12,padding:"8px 16px",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer" }}>Manage →</button>
            </div>
          </div>

          {/* Quick links */}
          <div style={{ display:"flex",flexDirection:"column",gap:10,marginBottom:20 }}>
            {[
              { icon:"🗃️", label:"My Vault", sub:`${myCards.length} figures · $${myCards.reduce((s,f)=>s+f.value,0).toLocaleString()} total value`, tab:"vault", color:"#3A7BD5" },
              { icon:"💰", label:"Wallet & Payments", sub:`Earnings: $${fmt(myUser?.walletBalance||0)} · Card at checkout`, tab:"wallet", color:"#00b894" },
              { icon:"📦", label:"Shipping & Tracking", sub:`${(db.shipments||[]).filter(s=>s.fromUser===activeUserId||s.toUser===activeUserId).length} shipments`, tab:"shipping", color:"#f0932b" },
              { icon:"⭐", label:"My Ratings", sub:`${(db.ratings||[]).filter(r=>r.toUserId===activeUserId).length} reviews · avg ${myUser?.rating}`, action:()=>{ setTab("account"); setTimeout(()=>ratingsSectionRef.current?.scrollIntoView({ behavior:"smooth", block:"start" }), 80); }, color:"#f9ca24" },
            ].map(item => (
              <div key={item.label} onClick={item.action || (()=>setTab(item.tab))} style={{ background:"#fff",borderRadius:18,padding:"14px 16px",boxShadow:"0 2px 10px rgba(0,0,0,0.05)",border:"1px solid #E4EBF2",display:"flex",alignItems:"center",gap:14,cursor:"pointer",transition:"transform 0.15s" }}
                onMouseDown={e=>e.currentTarget.style.transform="scale(0.98)"}
                onMouseUp={e=>e.currentTarget.style.transform="scale(1)"}
              >
                <div style={{ width:44,height:44,borderRadius:14,background:`${item.color}15`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0 }}>{item.icon}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800,fontSize:14,color:"#2C3E50" }}>{item.label}</div>
                  <div style={{ fontSize:11,color:"#aaa",marginTop:2 }}>{item.sub}</div>
                </div>
                <div style={{ fontSize:18,color:"#ddd" }}>›</div>
              </div>
            ))}
          </div>

          {/* Settings section */}
          <div style={{ fontWeight:700,fontSize:12,color:"#bbb",letterSpacing:1,marginBottom:10 }}>SETTINGS</div>
          <div style={{ background:"#fff",borderRadius:18,overflow:"hidden",boxShadow:"0 2px 10px rgba(0,0,0,0.05)",border:"1px solid #E4EBF2",marginBottom:20 }}>
            {[
              { icon:"💸", label:"Fees & Pricing",     sub:"Sales 5% · Trades $2/party · Shipping split", action:()=>setTab("fees") },
              { icon:"✏️", label:"Edit Profile",        sub:`${myUser?.username} · ${myUser?.location||"Location not set"}`, action:()=>openEditProfile("profile") },
              { icon:"🎭", label:"Change Avatar",       sub:`Current: ${myUser?.avatar}`, action:()=>openEditProfile("avatar") },
              { icon:"⭐", label:"Wishlist Tags",       sub:myUser?.wishlist?.length ? myUser.wishlist.map(t=>`#${t}`).join(" ") : "None set — tap to add", action:()=>openEditProfile("wishlist") },
              { icon:"📍", label:"Shipping Addresses",  sub: myUser?.addresses?.length ? myUser.addresses.map(a=>`${a.label}: ${a.street}`).join(" · ") : "No addresses saved", action:()=>setShowAddressModal(true) },
              { icon:"🔔", label:"Notifications",       sub:"Trade alerts, delivery updates", action:()=>setShowNotifications(true) },
              { icon:"🔒", label:"Privacy & Security",  sub:"Export data, deactivate, delete account", action:()=>openEditProfile("danger") },
              { icon:"📋", label:"Transaction History", sub:`${myTxns.length} transactions`, action:()=>setTab("wallet") },
              { icon:"🛡️", label:"Admin Dashboard",     sub:"Users, listings, disputes, ops tools", action:()=>setTab("db") },
              { icon:"📧", label:"Email Templates",     sub:"Transactional email previews", action:()=>setTab("emails") },
            ].map((item,i,arr) => (
              <div key={item.label} onClick={item.action} style={{ display:"flex",alignItems:"center",gap:12,padding:"14px 16px",borderBottom:i<arr.length-1?"1px solid #EEF2F7":"none",cursor:"pointer" }}
                onMouseEnter={e=>e.currentTarget.style.background="#fafafa"}
                onMouseLeave={e=>e.currentTarget.style.background="#fff"}
              >
                <span style={{ fontSize:20,width:28,textAlign:"center" }}>{item.icon}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700,fontSize:13,color:"#2C3E50" }}>{item.label}</div>
                  <div style={{ fontSize:11,color:"#aaa",marginTop:1 }}>{item.sub}</div>
                </div>
                <div style={{ fontSize:16,color:"#ddd" }}>›</div>
              </div>
            ))}
          </div>

          {/* Received Ratings */}
          {(db.ratings||[]).filter(r=>r.toUserId===activeUserId).length > 0 && (
            <>
              <div ref={ratingsSectionRef} style={{ fontWeight:700,fontSize:12,color:"#bbb",letterSpacing:1,marginBottom:10 }}>YOUR RATINGS</div>
              <div style={{ background:"#fff",borderRadius:18,overflow:"hidden",boxShadow:"0 2px 10px rgba(0,0,0,0.05)",border:"1px solid #E4EBF2",marginBottom:20 }}>
                {(db.ratings||[]).filter(r=>r.toUserId===activeUserId).map((r,i,arr)=>{
                  const from = getUser(r.fromUserId);
                  return (
                    <div key={r.id} style={{ padding:"14px 16px",borderBottom:i<arr.length-1?"1px solid #EEF2F7":"none" }}>
                      <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:6 }}>
                        <span style={{ fontSize:20 }}>{from?.avatar}</span>
                        <div style={{ flex:1 }}>
                          <div style={{ fontWeight:700,fontSize:13,color:"#2C3E50" }}>{from?.username}</div>
                          <div style={{ fontSize:10,color:"#aaa" }}>{r.date}</div>
                        </div>
                        <div style={{ display:"flex",gap:2 }}>{[1,2,3,4,5].map(s=><span key={s} style={{ fontSize:14,filter:s<=r.score?"none":"grayscale(1)" }}>⭐</span>)}</div>
                      </div>
                      {r.comment && <div style={{ fontSize:12,color:"#555",lineHeight:1.5,paddingLeft:30 }}>{r.comment}</div>}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Sign out */}
          <button onClick={onSignOut} style={{ width:"100%",background:"#fff0f0",border:"none",borderRadius:14,padding:"13px",fontWeight:700,fontSize:13,color:"#ff6b6b",cursor:"pointer",marginTop:4 }}>
            Sign Out
          </button>
        </div>
      )}

      {!(tab === "messages" && activeThread) && (
      <nav className="inhand-bottom-nav" aria-label="Primary">
        {NAV_ITEMS.map(([id, label]) => (
          <button key={id} type="button" data-active={tab === id ? "true" : "false"} onClick={() => goToTab(id)}>
            <span aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      )}
      </div>
    </div>
  );
}
