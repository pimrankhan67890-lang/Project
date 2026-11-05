(() => {
  'use strict';

  const authRoot = document.getElementById('auth-root');
  const appRoot = document.getElementById('app-root');
  const modalRoot = document.getElementById('modal-root');
  const toastRoot = document.getElementById('toast-root');
  const CONSENT_VERSION = 'v1.1';
  const VIGNAN_CAMPUS_CENTER = [16.232529, 80.547941];
  const state = {
    user: null, view: null, demoLogin: null, menuOpen: false, bootstrapTokenRequired: false, sampleDataAvailable: true,
    studentSearch: '', studentStatus: 'all', eventSearch: '', eventType: 'all', eventZone: 'all',
    tracking: false, locationTimer: null, pollTimer: null, loading: false,
    geofences: [], liveRows: [], lastDashboard: null, notifications: [], mapInstances: [], lastPosition: null,
    mapProvider: null, mapApiPromise: null, googleMapAuthFailed: false
  };

  const icons = {
    grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    radar:'<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v8.3l5.8 3.4"/><path d="M7.5 17.5a6.4 6.4 0 0 1 9-9"/>',
    people:'<path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20"/><circle cx="10" cy="7" r="3.3"/><path d="M16 4.2a3.4 3.4 0 0 1 0 6.6M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35"/>',
    pin:'<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.3"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    bell:'<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
    shield:'<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
    search:'<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.2 4.2"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
    route:'<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h2.2a3.8 3.8 0 0 0 3.8-3.8v-4.4A3.8 3.8 0 0 1 17.8 6H16"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9A7 7 0 0 1 17 6.5L20 9M4 15l3 2.5A7 7 0 0 0 18.5 15"/>',
    exit:'<path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6"/>',
    location:'<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.4"/>',
    user:'<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="8" r="4"/>',
    menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
    close:'<path d="m18 6-12 12M6 6l12 12"/>',
    lock:'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3M12 14v3"/>',
    activity:'<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    calendar2:'<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 9h18"/>',
    eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
    shieldAlert:'<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="M12 8v4M12 16h.01"/>'
  };
  const icon = (name, cls='') => icons[name] ? `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>` : '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const byId = id => document.getElementById(id);
  const parseDate = value => {
    if(!value) return null;
    const date=value instanceof Date?value:new Date(value);
    return Number.isNaN(date.getTime())?null:date;
  };
  const dateFmt = value => {const date=parseDate(value);return date?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric'}).format(date):'—';};
  const timeFmt = value => {const date=parseDate(value);return date?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'}).format(date):'—';};
  const dateTimeFmt = value => {const date=parseDate(value);return date?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(date):'—';};
  const initials = name => String(name || 'V').split(/\s+/).slice(0,2).map(s=>s[0]||'').join('').toUpperCase();
  const niceEvent = type => ({campus_entry:'Campus entry',campus_exit:'Campus exit',zone_entry:'Zone entry',zone_exit:'Zone exit',location_review:'Needs review',tracking_stopped:'Tracking stopped',tracking_stale:'Session paused'}[type] || String(type||'Activity').replaceAll('_',' '));
  const eventClass = type => type==='campus_entry'?'event-entry':type==='campus_exit'?'event-exit':type==='zone_entry'||type==='zone_exit'?'event-zone':type==='location_review'?'event-review':'event-system';
  const humanAgo = value => {
    const date=parseDate(value);
    if(!date) return '—';
    const seconds=Math.max(0,Math.floor((Date.now()-date.getTime())/1000));
    if(seconds<60) return 'just now';
    if(seconds<3600) return `${Math.floor(seconds/60)}m ago`;
    if(seconds<86400) return `${Math.floor(seconds/3600)}h ago`;
    return dateFmt(date);
  };
  const cookie = name => document.cookie.split('; ').find(row=>row.startsWith(`${name}=`))?.split('=').slice(1).join('=') || '';
  const api = async (path, options={}) => {
    const headers = new Headers(options.headers || {});
    if(options.body && !(options.body instanceof FormData)) headers.set('Content-Type','application/json');
    if(!['GET','HEAD'].includes((options.method || 'GET').toUpperCase())) {
      const csrf = cookie('vignan_csrf');
      if(csrf) headers.set('X-CSRF-Token',decodeURIComponent(csrf));
    }
    const response = await fetch(path,{credentials:'same-origin',cache:'no-store',...options,headers});
    const type=response.headers.get('content-type')||'';
    const data=type.includes('application/json')?await response.json():await response.text();
    if(!response.ok) {
      if(response.status===401 && state.user) await signOut(false,false);
      throw new Error(data?.detail || `Request failed (${response.status})`);
    }
    return data;
  };
  const postJson = (path, body, method='POST') => api(path,{method,body:JSON.stringify(body)});
  const toast = (message, error=false) => {const el=document.createElement('div');el.className=`toast${error?' error':''}`;el.textContent=message;toastRoot.append(el);setTimeout(()=>el.remove(),3300);};

  function showAuth(mode='login', message='', demoLogin=null, setupOptions={}){
    state.user=null;
    appRoot.hidden=true;
    appRoot.innerHTML='';
    authRoot.hidden=false;
    const setup=mode==='setup';
    const studentPortal=!setup&&location.pathname==='/student';
    state.bootstrapTokenRequired=Boolean(setupOptions.bootstrapTokenRequired);
    state.sampleDataAvailable=setupOptions.sampleDataAvailable!==false;
    authRoot.innerHTML=`<div class="auth-screen"><section class="auth-visual"><div class="auth-brand"><span class="brand-logo"><img src="https://vignan.ac.in/vignanconnect/assets/vignan.svg" alt="Vignan" data-brand-logo></span><span><strong>VIGNAN</strong><small>SMART CAMPUS · VADLAMUDI</small></span></div><div class="auth-copy"><div class="eyebrow"><i></i>SMART CAMPUS PRESENCE</div><h1>Campus presence,<br>with clarity.</h1><p>Verified entry and exit activity, zone-level campus visibility, and student-controlled location sharing for Vignan.</p><div class="auth-pill-row"><span class="auth-pill">GPS verified</span><span class="auth-pill">Zone aware</span><span class="auth-pill">Consent first</span><span class="auth-pill">Audit ready</span></div></div><div class="auth-foot">Vignan’s Foundation for Science, Technology and Research · Vadlamudi, Guntur</div></section><section class="auth-panel"><div class="auth-card"><div class="eyebrow"><i></i>${setup?'FIRST-TIME SETUP':studentPortal?'STUDENT SIGN IN':'CAMPUS OPERATIONS'}</div><h2>${setup?'Set up your workspace':studentPortal?'Student sign in':'Welcome back'}</h2><p>${setup?'Create the first campus administrator. This workspace stores only campus presence, geofences, and related activity.':studentPortal?'Student accounts are created by campus administration. Sign in here with your student email and password to open your personal campus presence.':'Sign in with your campus operations or student account.'}</p>${message?`<div class="auth-error">${esc(message)}</div>`:''}${setup?setupForm(demoLogin,state.bootstrapTokenRequired,state.sampleDataAvailable):loginForm(studentPortal)}${setup?'':studentPortal?`<div class="auth-swap">Campus staff? <a href="/">Campus staff sign in</a>. Student accounts are created by an administrator.</div>`:`<div class="auth-swap">Student? <a href="/student">Student sign in</a>.</div>`}</div></section></div>`;
    bindBrandFallbacks();
  }
  function bindBrandFallbacks(){document.querySelectorAll('img[data-brand-logo]').forEach(img=>img.addEventListener('error',()=>{const fallback=document.createElement('span');fallback.className='brand-fallback';fallback.textContent='V';img.replaceWith(fallback);},{once:true}));}
  function loginForm(studentPortal=false){return `<form id="login-form" data-form="login"><label class="field-label" for="login-email">${studentPortal?'STUDENT EMAIL':'CAMPUS EMAIL'}</label><input class="field-input" id="login-email" name="email" type="email" autocomplete="username" required placeholder="${studentPortal?'student@vignan.ac.in':'you@vignan.ac.in'}"><label class="field-label" for="login-password">PASSWORD</label><input class="field-input" id="login-password" name="password" type="password" autocomplete="current-password" required><button class="primary-button auth-submit" type="submit">Sign in ${icon('arrow')}</button></form>`;}
  function setupForm(demoLogin=null,bootstrapTokenRequired=false,sampleDataAvailable=true){return `<form id="setup-form" data-form="setup"><label class="field-label" for="setup-name">ADMINISTRATOR NAME</label><input class="field-input" id="setup-name" name="full_name" required minlength="2" maxlength="140" placeholder="Campus administrator"><label class="field-label" for="setup-email">CAMPUS EMAIL</label><input class="field-input" id="setup-email" name="email" type="email" required placeholder="admin@vignan.ac.in"><label class="field-label" for="setup-campus">CAMPUS NAME</label><input class="field-input" id="setup-campus" name="campus_name" required value="Vignan · Vadlamudi Campus">${bootstrapTokenRequired?'<label class="field-label" for="setup-bootstrap-token">ONE-TIME SETUP TOKEN</label><input class="field-input" id="setup-bootstrap-token" name="bootstrap_token" type="password" autocomplete="off" required><div class="field-hint">Provided to the production operator for first administrator setup.</div>':''}<label class="field-label" for="setup-password">ADMIN PASSWORD</label><input class="field-input" id="setup-password" name="password" type="password" required minlength="12" maxlength="72" autocomplete="new-password"><div class="field-hint">Use at least 12 characters. This password is stored as a salted bcrypt hash.</div>${sampleDataAvailable?'<label class="seed-option"><input type="checkbox" name="seed_sample" checked><span>Load clearly marked synthetic students and example geofences so I can exercise the flows. The sample boundary will not work in production.</span></label>':''}<button class="primary-button auth-submit" type="submit">Create workspace ${icon('arrow')}</button></form>${demoLogin?`<div class="auth-success"><strong>Workspace ready</strong>Demo student sign-in (shown once):<div class="demo-credential">${esc(demoLogin.student_email)}<br>${esc(demoLogin.student_password)}</div></div>`:''}`;}

  function navItems(){
    if(state.user?.role==='student') return [
      ['overview','My presence','grid'],['activity','My activity','clock'],['notifications','Alerts','bell'],['privacy','Privacy & consent','shield']
    ];
    const items=[['overview','Overview','grid'],['presence','Live presence','radar']];
    if(state.user?.role==='admin') items.push(['students','Students','people']);
    if(state.user?.role==='admin') items.push(['zones','Geo-zones','pin']);
    items.push(['activity','Activity history','clock'],['notifications','Alerts','bell']);
    if(state.user?.role==='admin') items.push(['privacy','Privacy & access','shield']);
    return items;
  }
  const viewLabels={overview:'Overview',presence:'Live presence',students:'Students',zones:'Geo-zones',activity:'Activity history',notifications:'Alerts',privacy:'Privacy & access'};
  function renderShell(){
    authRoot.hidden=true;
    appRoot.hidden=false;
    const list=navItems();
    appRoot.innerHTML=`<div class="app-layout"><aside class="sidebar" id="sidebar"><a class="brand" href="#" data-view="overview"><span class="brand-logo"><img src="https://vignan.ac.in/vignanconnect/assets/vignan.svg" alt="Vignan" data-brand-logo></span><span class="brand-text"><strong>VIGNAN</strong><small>SMART CAMPUS</small></span></a><div class="campus-context"><span class="campus-pulse"></span><span><small>ACTIVE CAMPUS</small><strong id="campus-name">Vignan · Vadlamudi Campus</strong></span></div><div class="nav-label">CAMPUS PRESENCE</div><nav class="nav-list" aria-label="Campus navigation">${list.map(([key,label,ico])=>`<button class="nav-item ${state.view===key?'active':''}" data-view="${key}">${icon(ico)}<span>${label}</span>${key==='notifications'?'<span id="nav-notification-count" class="nav-count" hidden></span>':''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="sidebar-help"><span class="help-mark">i</span><span><strong>Presence help</strong><small>Location shares only during an active session.</small></span></div><button class="user-menu" data-action="account-menu"><span class="avatar">${esc(initials(state.user.full_name))}</span><span class="user-copy"><strong>${esc(state.user.full_name)}</strong><small>${esc(state.user.role==='admin'?'Campus administrator':state.user.role==='security'?'Campus security':'Student account')}</small></span><span class="more">•••</span></button></div></aside><main class="main-column"><header class="topbar"><div class="crumbs"><button class="icon-button mobile-menu-button" data-action="mobile-menu" aria-label="Open menu">${icon('menu')}</button><span>Campus operations</span><span class="slash">/</span><strong id="crumb-current">${esc(viewLabels[state.view]||'Overview')}</strong></div><div class="top-actions"><span class="top-campus-live"><i class="live-dot"></i>Presence monitoring active</span><button class="icon-button" data-view="notifications" aria-label="Notifications">${icon('bell')}<span class="alert-dot" id="top-notification-dot" hidden></span></button><button class="icon-button" data-action="account-menu" aria-label="Account">${icon('user')}</button></div></header><div class="page-content" id="page" tabindex="-1"></div></main></div>`;
    bindBrandFallbacks();
    loadView();
    refreshNotificationBadge();
    if(state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer=setInterval(()=>{
      if(!state.user||document.hidden||state.loading) return;
      if(['overview','presence','notifications'].includes(state.view)) loadView(false);
      refreshNotificationBadge();
    },15000);
  }
  function pageHead(title, description, actions=''){
    return `<div class="page-head"><div><div class="eyebrow"><i></i>VIGNAN SMART CAMPUS</div><h1>${title}</h1><p>${description}</p></div><div class="head-actions">${actions}</div></div>`;
  }
  function demoBanner(text='Synthetic workspace data is visible. Replace demo students and boundaries before operational use.'){
    return `<div class="notice-strip warn"><span class="notice-icon">!</span><span><strong>Sample data:</strong> ${esc(text)}</span></div>`;
  }
  function iconButton(label,ico,action){return `<button class="outline-button" data-action="${action}">${icon(ico)} ${label}</button>`;}
  function metric(label,value,foot,ico,delta=''){
    return `<article class="metric-card"><div class="metric-head"><span>${esc(label)}</span><span class="metric-icon">${icon(ico)}</span></div><div class="metric-value-line"><strong class="metric-value">${esc(value)}</strong>${delta?`<span class="metric-delta">${esc(delta)}</span>`:''}</div><div class="metric-foot">${esc(foot)}</div></article>`;
  }

  function mapMarkup(zones, liveRows, id='campus-map'){
    const active=zones.filter(z=>z.active);
    const campus=active.find(z=>z.zone_type==='campus');
    return `<div id="${id}" class="real-map" role="application" aria-label="Interactive OpenStreetMap with campus geofences and current consented student locations"></div>${campus?.demo_boundary?'<div class="map-footnote">Sample geofence circles are approximate and shown for demonstration only.</div>':''}`;
  }

  function destroyMaps(){
    state.mapInstances.forEach(map=>{try{map.remove();}catch(_){}});
    state.mapInstances=[];
  }

  function addBaseTiles(map){
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:20,
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
    }).addTo(map);
  }

  async function loadGoogleMapsApi(apiKey){
    if(window.google?.maps)return;
    if(state.mapApiPromise)return state.mapApiPromise;
    state.mapApiPromise=new Promise((resolve,reject)=>{
      window.vignanMapsReady=()=>resolve();
      window.gm_authFailure=()=>{state.googleMapAuthFailed=true;};
      const script=document.createElement('script');
      script.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&callback=vignanMapsReady&v=weekly`;
      script.async=true;script.defer=true;
      script.onerror=()=>reject(new Error('Google Maps could not load. Check the API key, Maps JavaScript API, billing, and website restrictions.'));
      document.head.append(script);
    });
    return state.mapApiPromise;
  }

  async function resolveMapProvider(){
    if(state.mapProvider)return state.mapProvider;
    try{
      const response=await fetch('/api/map/config',{credentials:'same-origin'});
      if(!response.ok)throw new Error('Map configuration is unavailable.');
      const config=await response.json();
      if(config.provider==='google'&&config.google_maps_api_key){
        await loadGoogleMapsApi(config.google_maps_api_key);
        state.mapProvider='google';
      }else state.mapProvider=window.L?'osm':'none';
    }catch(error){
      console.warn(error);
      state.mapProvider=window.L?'osm':'none';
    }
    return state.mapProvider;
  }

  function rememberGoogleMap(map, overlays, listeners, cleanup=()=>{}){
    state.mapInstances.push({container:map.getDiv(),remove(){
      overlays.forEach(overlay=>overlay.setMap(null));
      listeners.forEach(listener=>window.google.maps.event.removeListener(listener));
      window.google.maps.event.clearInstanceListeners(map);
      cleanup();
    }});
  }

  function mountGoogleCampusMap(node, studentView, campus, own){
    const center=own?[Number(own.latitude),Number(own.longitude)]:campus?[Number(campus.latitude),Number(campus.longitude)]:VIGNAN_CAMPUS_CENTER;
    const map=new window.google.maps.Map(node,{center:{lat:center[0],lng:center[1]},zoom:own?18:16,
      mapTypeId:'roadmap',mapTypeControl:true,fullscreenControl:true,streetViewControl:false});
    const overlays=[],listeners=[],info=new window.google.maps.InfoWindow();
    const google=window.google.maps;
    const ref=new google.Marker({map,position:{lat:VIGNAN_CAMPUS_CENTER[0],lng:VIGNAN_CAMPUS_CENTER[1]},title:'Vignan Vadlamudi campus',
      icon:{path:google.SymbolPath.CIRCLE,scale:5,fillColor:'#174d38',fillOpacity:1,strokeColor:'#fff',strokeWeight:2}});
    overlays.push(ref);
    listeners.push(ref.addListener('click',()=>{info.setContent('<strong>Vignan Vadlamudi campus</strong><br>Published administrative-block reference point. This is not a surveyed campus perimeter.');info.open({map,anchor:ref});}));
    state.geofences.filter(zone=>zone.active).forEach(zone=>{
      const campusZone=zone.zone_type==='campus';
      const circle=new google.Circle({map,center:{lat:Number(zone.latitude),lng:Number(zone.longitude)},radius:Number(zone.radius_m),
        strokeColor:campusZone?'#b58d2a':'#327b58',strokeOpacity:.9,strokeWeight:campusZone?3:2,
        fillColor:campusZone?'#e7c35a':'#5b9e74',fillOpacity:campusZone ? 0.13 : 0.12,clickable:true});
      overlays.push(circle);
      listeners.push(circle.addListener('click',event=>{info.setContent(`<strong>${esc(zone.name)}</strong><br>${Number(zone.radius_m)} m radius${zone.demo_boundary?'<br><em>Sample geofence</em>':''}`);info.setPosition(event.latLng);info.open(map);}));
    });
    if(studentView){
      if(own&&Number.isFinite(Number(own.latitude))&&Number.isFinite(Number(own.longitude))){
        const point={lat:Number(own.latitude),lng:Number(own.longitude)};
        const accuracy=new google.Circle({map,center:point,radius:Number(own.accuracy_m)||20,strokeColor:'#1686d9',strokeOpacity:.4,strokeWeight:1,fillColor:'#1686d9',fillOpacity:.09});
        const marker=new google.Marker({map,position:point,title:'Your current GPS position',
          icon:{path:google.SymbolPath.CIRCLE,scale:8,fillColor:'#1686d9',fillOpacity:1,strokeColor:'#fff',strokeWeight:3}});
        overlays.push(accuracy,marker);
        listeners.push(marker.addListener('click',()=>{info.setContent('<strong>Your current GPS position</strong><br>Visible only in your student account.');info.open({map,anchor:marker});}));
      }
    }else{
      state.liveRows.filter(row=>row.latitude!=null&&row.longitude!=null).forEach(row=>{
        const marker=new google.Marker({map,position:{lat:Number(row.latitude),lng:Number(row.longitude)},title:row.student_name,
          icon:{path:google.SymbolPath.CIRCLE,scale:7,fillColor:row.demo_record?'#8b75b8':'#1686d9',fillOpacity:1,strokeColor:'#fff',strokeWeight:2}});
        overlays.push(marker);
        listeners.push(marker.addListener('click',()=>{info.setContent(`<strong>${esc(row.student_name)}</strong>${row.student_no?`<br>${esc(row.student_no)}`:''}<br>${esc(row.zone_name||'Campus')}<br>Updated ${esc(humanAgo(row.location_updated_at||row.last_seen_at))}${row.demo_record?'<br><em>Sample record</em>':''}`);info.open({map,anchor:marker});}));
      });
    }
    rememberGoogleMap(map,overlays,listeners);
  }

  async function mountCampusMap(id, studentView=false){
    const node=byId(id);
    if(!node)return;
    const provider=await resolveMapProvider();
    if(provider==='none'){node.innerHTML='<div class="map-unavailable">Map did not load. Check the internet connection and refresh.</div>';return;}
    const campus=state.geofences.find(z=>z.active&&z.zone_type==='campus');
    const own=studentView?(state.liveRows.find(row=>row.student_id===state.user?.id&&row.latitude!=null)||state.lastPosition):null;
    if(provider==='google'){mountGoogleCampusMap(node,studentView,campus,own);return;}
    if(!window.L){node.innerHTML='<div class="map-unavailable">Map library did not load. Check the internet connection and refresh.</div>';return;}
    const anchor=campus?[Number(campus.latitude),Number(campus.longitude)]:VIGNAN_CAMPUS_CENTER;
    const initial=own?[Number(own.latitude),Number(own.longitude)]:anchor;
    const map=window.L.map(node,{scrollWheelZoom:false,preferCanvas:true}).setView(initial,own?18:16);
    state.mapInstances.push(map);
    addBaseTiles(map);
    window.L.circleMarker(VIGNAN_CAMPUS_CENTER,{radius:5,color:'#fff',weight:2,fillColor:'#174d38',fillOpacity:1}).addTo(map)
      .bindPopup('<strong>Vignan Vadlamudi campus</strong><br>Published administrative-block reference point. This is not a surveyed campus perimeter.');
    state.geofences.filter(z=>z.active).forEach(zone=>{
      const campusZone=zone.zone_type==='campus';
      const circle=window.L.circle([Number(zone.latitude),Number(zone.longitude)],{
        radius:Number(zone.radius_m),color:campusZone?'#b58d2a':'#327b58',
        weight:campusZone?3:2,opacity:.9,fillColor:campusZone?'#e7c35a':'#5b9e74',
        fillOpacity:campusZone ? 0.13 : 0.12,dashArray:zone.demo_boundary?'7 6':null
      }).addTo(map);
      circle.bindPopup(`<strong>${esc(zone.name)}</strong><br>${Number(zone.radius_m)} m radius${zone.demo_boundary?'<br><em>Sample geofence</em>':''}`);
      circle.bindTooltip(esc(zone.name),{direction:'top',sticky:true});
    });
    if(studentView){
      if(own&&Number.isFinite(Number(own.latitude))&&Number.isFinite(Number(own.longitude))){
        const point=[Number(own.latitude),Number(own.longitude)];
        window.L.circle(point,{radius:Number(own.accuracy_m)||20,color:'#1686d9',weight:1,fillColor:'#1686d9',fillOpacity:.09}).addTo(map);
        window.L.circleMarker(point,{radius:8,color:'#fff',weight:3,fillColor:'#1686d9',fillOpacity:1}).addTo(map)
          .bindPopup('<strong>Your current GPS position</strong><br>Visible only in your student account.');
      }
    }else{
      state.liveRows.filter(row=>row.latitude!=null&&row.longitude!=null).forEach(row=>{
        const point=[Number(row.latitude),Number(row.longitude)];
        const marker=window.L.circleMarker(point,{radius:7,color:'#fff',weight:2,fillColor:row.demo_record?'#8b75b8':'#1686d9',fillOpacity:1}).addTo(map);
        marker.bindPopup(`<strong>${esc(row.student_name)}</strong>${row.student_no?`<br>${esc(row.student_no)}`:''}<br>${esc(row.zone_name||'Campus')}<br>Updated ${esc(humanAgo(row.location_updated_at||row.last_seen_at))}${row.demo_record?'<br><em>Sample record</em>':''}`);
      });
    }
    setTimeout(()=>map.invalidateSize(),80);
  }

  async function mountZonePicker(center){
    const node=byId('zone-map-picker');
    if(!node)return;
    const point=center||VIGNAN_CAMPUS_CENTER;
    const provider=await resolveMapProvider();
    if(provider==='google'){
      const google=window.google.maps;
      const map=new google.Map(node,{center:{lat:point[0],lng:point[1]},zoom:17,mapTypeId:'roadmap',streetViewControl:false});
      const position={lat:point[0],lng:point[1]};
      const marker=new google.Marker({map,position,draggable:true,title:'Geo-zone center'});
      const radius=new google.Circle({map,center:position,radius:Number(byId('zone-radius')?.value)||600,
        strokeColor:'#b58d2a',strokeOpacity:.9,strokeWeight:2,fillColor:'#e7c35a',fillOpacity:.1,clickable:false});
      const update=latLng=>{
        const location={lat:typeof latLng.lat==='function'?latLng.lat():latLng.lat,
          lng:typeof latLng.lng==='function'?latLng.lng():latLng.lng};
        byId('zone-lat').value=location.lat.toFixed(7);
        byId('zone-lon').value=location.lng.toFixed(7);
        marker.setPosition(location);radius.setCenter(location);
      };
      const listeners=[map.addListener('click',event=>update(event.latLng)),
        marker.addListener('dragend',()=>update(marker.getPosition()))];
      const radiusInput=byId('zone-radius');
      const updateRadius=event=>radius.setRadius(Number(event.target.value)||25);
      radiusInput?.addEventListener('input',updateRadius);
      rememberGoogleMap(map,[marker,radius],listeners,()=>radiusInput?.removeEventListener('input',updateRadius));
      setTimeout(()=>google.event.trigger(map,'resize'),80);
      return;
    }
    if(provider!=='osm'||!window.L){node.innerHTML='<div class="map-unavailable">Map did not load. Check the internet connection and refresh.</div>';return;}
    const map=window.L.map(node,{scrollWheelZoom:false}).setView(point,17);
    state.mapInstances.push(map);
    addBaseTiles(map);
    const marker=window.L.marker(point,{draggable:true}).addTo(map);
    const radius=window.L.circle(point,{radius:Number(byId('zone-radius')?.value)||600,color:'#b58d2a',weight:2,fillColor:'#e7c35a',fillOpacity:.1}).addTo(map);
    const update=(latlng)=>{
      byId('zone-lat').value=latlng.lat.toFixed(7);
      byId('zone-lon').value=latlng.lng.toFixed(7);
      radius.setLatLng(latlng);
    };
    map.on('click',event=>{marker.setLatLng(event.latlng);update(event.latlng);});
    marker.on('dragend',event=>update(event.target.getLatLng()));
    byId('zone-radius')?.addEventListener('input',event=>radius.setRadius(Number(event.target.value)||25));
    setTimeout(()=>map.invalidateSize(),80);
  }

  function zonePulseMarkup(zones, liveRows){
    const active=zones.filter(z=>z.active);
    const campus=active.find(z=>z.zone_type==='campus');
    const total=liveRows.length;
    const items=active.filter(z=>z.zone_type!=='campus').map(z=>({zone:z,count:liveRows.filter(r=>r.zone_id===z.id).length}));
    const campusCount=liveRows.filter(r=>campus && (r.zone_id===campus.id || !r.zone_id)).length;
    const percent=total ? Math.min(100,Math.round((campusCount/total)*100)) : 0;
    return `<section class="panel zone-pulse"><div class="panel-head"><div class="panel-title"><span class="title-icon">${icon('radar')}</span><span><h2>Campus presence</h2><small>Presence by configured zone</small></span></div><button class="panel-action" data-view="zones">Manage zones →</button></div><div class="presence-summary"><div class="presence-ring" style="--value:${percent}"><span>${total}</span></div><div class="presence-summary-copy"><strong>${total} on campus</strong><small>${campus?`${active.length} active geofence${active.length===1?'':'s'}`:'Campus boundary not configured'}</small><em>Updated just now</em></div></div><div class="zone-list">${items.length?items.map(({zone,count})=>`<div class="zone-meter"><span class="zone-meter-name" title="${esc(zone.name)}">${esc(zone.name)}</span><span class="meter-track"><span style="width:${Math.min(100,Math.max(count?8:0,count*4))}%"></span></span><span class="zone-meter-count">${count}</span></div>`).join(''):`<div class="table-empty" style="padding:14px 0">No sub-zones configured yet.</div>`}</div><div class="panel-foot" style="padding:12px 0 0"><span>Only zone-level occupancy is displayed.</span><strong>${active.filter(z=>z.demo_boundary).length?`${active.filter(z=>z.demo_boundary).length} demo`: 'Verified config'}</strong></div></section>`;
  }

  function eventRows(items, showStudent=true){
    if(!items.length) return `<tr><td colspan="5"><div class="table-empty">No activity matches these filters.</div></td></tr>`;
    return items.map(e=>`<tr><td>${showStudent?`<div class="student-cell"><span class="avatar">${esc(initials(e.student_name))}</span><span><span class="student-name">${esc(e.student_name)}</span><span class="student-meta">${esc(e.student_no||'')}</span></span></div>`:`<span class="student-name">${esc(niceEvent(e.event_type))}</span>`}</td><td><span class="event-pill ${eventClass(e.event_type)}">${esc(niceEvent(e.event_type))}</span></td><td>${esc(e.zone_name||'Campus boundary')}</td><td class="time-text">${esc(timeFmt(e.created_at))}<span class="student-meta">${esc(dateFmt(e.created_at))}</span></td><td>${e.accuracy_m?`<span class="student-meta">± ${esc(e.accuracy_m)} m</span>`:'<span class="student-meta">—</span>'}</td></tr>`).join('');
  }
  function activityTable(items, showStudent=true){return `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>${showStudent?'Student':'Activity'}</th><th>Event</th><th>Campus zone</th><th>Time · IST</th><th>GPS accuracy</th></tr></thead><tbody>${eventRows(items,showStudent)}</tbody></table></div>`;}
  function liveTable(items, admin=true){
    if(!items.length) return `<div class="table-empty">No active presence sessions. Students appear after they consent and verify their location.</div>`;
    return `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Student</th><th>Current zone</th><th>Session started</th><th>Last location check</th><th>Status</th></tr></thead><tbody>${items.map(row=>`<tr><td><div class="student-cell"><span class="avatar">${esc(initials(row.student_name))}</span><span><span class="student-name">${esc(row.student_name)}</span><span class="student-meta">${esc(row.student_no||'')}${admin&&row.department?` · ${esc(row.department)}`:''}</span></span></div></td><td>${esc(row.zone_name||'Campus boundary')}</td><td class="time-text">${esc(timeFmt(row.started_at))}</td><td class="time-text">${esc(humanAgo(row.last_seen_at))}</td><td><span class="status-pill status-inside">On campus</span></td></tr>`).join('')}</tbody></table></div>`;
  }

  async function renderOverview(){
    if(state.user.role==='student') return renderStudentPresence();
    const [dash,live,events,zonesResp]=await Promise.all([api('/api/dashboard'),api('/api/presence/live'),api('/api/presence/events?limit=6'),api('/api/geofences')]);
    state.lastDashboard=dash;state.liveRows=live.items;state.geofences=zonesResp.items;
    const demo=dash.demo_data_present;
    const actions=`<span class="date-button">${icon('calendar')} Today <span style="color:#a2aaa3">⌄</span></span>${iconButton('Refresh','refresh','refresh')}`;
    return `${pageHead('Campus overview',`${esc(dash.campus_name)} · ${dateFmt(new Date())}`,actions)}${demo?demoBanner():''}<div class="metric-grid">${metric('Students on campus',dash.active_students,'Foreground sessions with recent verification','people')}${metric('Entries today',dash.today.campus_entry,'Verified campus boundary crossings','route')}${metric('Exits today',dash.today.campus_exit,'Verified campus boundary exits','exit')}${metric('Needs review',dash.today.location_review,'Low-accuracy location checks','shieldAlert',dash.today.location_review?'Review':'Clear')}</div><div class="content-grid"><section class="panel"><div class="panel-head"><div class="panel-title"><span class="title-icon">${icon('pin')}</span><span><h2>Campus map</h2><small>Current consented GPS positions and configured geofences</small></span></div><button class="panel-action" data-view="presence">Open live presence →</button></div><div class="zone-map-wrap">${mapMarkup(dash.zones,live.items,'campus-map')}</div><div class="panel-foot"><span>Latest point only · visible to authorized staff · no location history</span><span>Auto-refresh every 15 sec</span></div></section>${zonePulseMarkup(dash.zones,live.items)}</div><section class="panel table-panel"><div class="panel-head"><div class="panel-title"><span class="title-icon">${icon('clock')}</span><span><h2>Recent campus activity</h2><small>Verified entry, exit, zone transitions, and review events</small></span></div><button class="panel-action" data-view="activity">View activity history →</button></div>${activityTable(events.items,true)}<div class="table-bottom"><span>Showing latest ${events.items.length} events</span><span>Location coordinates are not retained in event history</span></div></section>${demo?`<div class="notice-strip danger"><span class="notice-icon">!</span><span>One or more geofences are marked as sample data. Edit each boundary with Vignan-surveyed coordinates before using attendance or safety decisions.</span><button data-view="zones">Review boundaries →</button></div>`:''}`;
  }

  async function renderPresence(){
    const [dash,live,zonesResp]=await Promise.all([api('/api/dashboard'),api('/api/presence/live'),api('/api/geofences')]);
    state.lastDashboard=dash;state.liveRows=live.items;state.geofences=zonesResp.items;
    const zones=zonesResp.items;
    return `${pageHead('Live campus presence','Monitor current GPS positions from students who have consented and have an active session.',`${iconButton('Export history','download','export')}${iconButton('Refresh','refresh','refresh')}`)}${dash.demo_data_present?demoBanner():''}<div class="metric-grid">${metric('Currently on campus',dash.active_students,'Active foreground sessions','people')}${metric('Active zones',`${dash.active_geofences} / ${dash.geofence_count}`,'Configured campus boundaries','pin')}${metric('Last refresh',timeFmt(live.updated_at),'Live presence service · IST','refresh')}${metric('Location reviews',dash.today.location_review,'Accuracy threshold requires review','shieldAlert')}</div><div class="content-grid"><section class="panel"><div class="panel-head"><div class="panel-title"><span class="title-icon">${icon('radar')}</span><span><h2>Live campus map</h2><small>Current student locations · auto-cleared when a session ends</small></span></div></div><div class="zone-map-wrap">${mapMarkup(zones,live.items,'presence-map')}</div></section>${zonePulseMarkup(zones,live.items)}</div><section class="panel table-panel"><div class="panel-head"><div class="panel-title"><span class="title-icon">${icon('people')}</span><span><h2>On-campus students</h2><small>${live.items.length} active sessions · stale sessions close automatically</small></span></div></div><div class="table-tools"><div class="tool-group"><label class="search-field">${icon('search')}<input id="live-search" value="${esc(state.studentSearch)}" placeholder="Search student or ID"></label><select id="live-zone-filter" class="select-input"><option value="all">All zones</option>${zones.map(z=>`<option value="${z.id}">${esc(z.name)}</option>`).join('')}</select></div><span class="student-meta">Updated ${esc(humanAgo(live.updated_at))}</span></div><div id="live-table">${liveTable(live.items,true)}</div></section>`;
  }

  async function renderStudents(){
    const [data,dash]=await Promise.all([api(`/api/students?q=${encodeURIComponent(state.studentSearch)}&status=${encodeURIComponent(state.studentStatus)}`),api('/api/dashboard')]);
    state.lastDashboard=dash;
    const rows=data.items;
    const table=rows.length?`<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Student</th><th>Department</th><th>Presence now</th><th>Last verified</th><th>Account</th><th></th></tr></thead><tbody>${rows.map(s=>`<tr><td><div class="student-cell"><span class="avatar">${esc(initials(s.full_name))}</span><span><span class="student-name">${esc(s.full_name)}</span><span class="student-meta">${esc(s.student_no||'')}</span></span></div></td><td>${esc(s.department||'—')}</td><td>${s.presence_status==='inside'?`<span class="status-pill status-inside">${esc(s.current_zone||'On campus')}</span>`:'<span class="status-pill status-outside">Outside</span>'}</td><td class="time-text">${esc(humanAgo(s.last_seen_at))}</td><td><span class="status-pill ${s.active?'status-inside':'status-review'}">${s.active?'Active':'Disabled'}</span></td><td>${state.user.role==='admin'?`<button class="edit-link" data-action="edit-student" data-id="${s.id}">Manage</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:`<div class="table-empty">No students found.</div>`;
    const actions=state.user.role==='admin'?`<button class="primary-button" data-action="add-student">${icon('plus')} Add student</button><button class="outline-button" data-action="add-security">${icon('shield')} Add staff account</button>${dash.demo_data_available?'<button class="outline-button" data-action="show-demo-data">Load demo data</button>':''}`:'';
    return `${pageHead('Student accounts','Manage the student identities used for presence verification.',actions)}${dash.demo_data_present?demoBanner('Synthetic student accounts are in this production database; do not treat them as real records.'):''}${state.user.role==='admin'?`<div class="notice-strip"><span class="notice-icon">i</span><span>Only the minimum identity details needed for campus presence are stored. Send initial credentials through Vignan’s approved channel.</span></div>`:''}<section class="panel table-panel"><div class="panel-head"><div class="panel-title"><span class="title-icon">${icon('people')}</span><span><h2>Students</h2><small>${data.total} account${data.total===1?'':'s'} in this result</small></span></div></div><div class="table-tools"><div class="tool-group"><label class="search-field">${icon('search')}<input id="student-search" value="${esc(state.studentSearch)}" placeholder="Search name, student number, email"></label><select class="select-input" id="student-status"><option value="all" ${state.studentStatus==='all'?'selected':''}>All presence</option><option value="inside" ${state.studentStatus==='inside'?'selected':''}>On campus</option><option value="outside" ${state.studentStatus==='outside'?'selected':''}>Outside</option></select></div><span class="student-meta">Presence access uses role checks</span></div>${table}<div class="table-bottom"><span>Student credentials are never shown after account creation.</span><span>Reset access from Manage.</span></div></section>`;
  }

  async function renderZones(){
    const result=await api('/api/geofences');state.geofences=result.items;
    const campus=result.items.find(z=>z.zone_type==='campus'&&z.active);
    const cards=result.items.map(z=>`<article class="geofence-card ${z.demo_boundary?'demo':''}"><div class="geofence-top"><span class="zone-symbol">${icon('pin')}</span><button class="toggle ${z.active?'on':''}" role="switch" aria-checked="${z.active}" aria-label="${z.active?'Pause':'Enable'} ${esc(z.name)}" data-action="toggle-zone" data-id="${z.id}"><span></span></button></div><h3>${esc(z.name)}</h3><p>${esc(z.zone_type==='campus'?'Campus boundary · entry and exit verification':`${z.zone_type[0].toUpperCase()+z.zone_type.slice(1)} zone · local presence verification`)}</p><div class="zone-detail-row"><span>Radius <strong>${esc(z.radius_m)} m</strong></span><span>${Number(z.latitude).toFixed(5)}, ${Number(z.longitude).toFixed(5)}</span></div><div class="zone-card-actions"><span class="verified-label ${z.demo_boundary?'demo':''}">${z.demo_boundary?'Sample boundary':'Boundary verified'}</span><button class="edit-link" data-action="edit-zone" data-id="${z.id}">Configure →</button></div></article>`).join('');
    return `${pageHead('Geofence configuration','Set campus and sub-zone boundaries for presence verification.',state.user.role==='admin'?`<button class="primary-button" data-action="add-zone">${icon('plus')} Add geo-zone</button>`:'')}<div class="notice-strip ${campus?.demo_boundary?'danger':''}"><span class="notice-icon">!</span><span>${campus?`${campus.demo_boundary?'The active campus boundary is sample data.':'The campus boundary is active.'} Sub-zones must fit inside it. Set center coordinates and radius from Vignan’s surveyed campus plan.`:'Create the surveyed campus boundary first. Presence verification remains disabled until it is configured.'}</span></div><div class="section-toolbar" style="display:flex;justify-content:space-between;align-items:center;margin:0 0 12px;color:#8a958d;font-size:8px"><span>${result.items.filter(z=>z.active).length} active · ${result.total} configured</span><span>Circle geofences · GPS accuracy threshold ${state.lastDashboard?.accuracy_limit_m||120} m</span></div>${cards?`<div class="geofence-grid">${cards}</div>`:`<section class="panel"><div class="table-empty">No geofences configured. Add a surveyed campus boundary to begin.</div></section>`}<div class="panel-foot" style="padding:12px 2px"><span>Changing a boundary is written to the audit history.</span><span>Coordinate reference: WGS 84 / decimal degrees</span></div>`;
  }

  async function renderActivity(){
    const params=new URLSearchParams({limit:'100',event_type:state.eventType});
    if(state.eventZone!=='all') params.set('zone_id',state.eventZone);
    if(state.eventSearch.trim()) params.set('q',state.eventSearch.trim());
    const [events,zones]=await Promise.all([api(`/api/presence/events?${params}`),api('/api/geofences')]);
    state.geofences=zones.items;
    return `${pageHead(state.user.role==='student'?'My campus activity':'Campus activity history','Review verified entry, exit, zone, and location-review events.',`${iconButton('Export CSV','download','export')}${iconButton('Refresh','refresh','refresh')}`)}<section class="panel table-panel"><div class="panel-head"><div class="panel-title"><span class="title-icon">${icon('clock')}</span><span><h2>Presence events</h2><small>Times are shown in India Standard Time</small></span></div></div><div class="table-tools"><div class="tool-group"><label class="search-field">${icon('search')}<input id="event-search" value="${esc(state.eventSearch)}" placeholder="Search name, ID, zone"></label><select class="select-input" id="event-type"><option value="all" ${state.eventType==='all'?'selected':''}>All events</option><option value="campus_entry" ${state.eventType==='campus_entry'?'selected':''}>Campus entry</option><option value="campus_exit" ${state.eventType==='campus_exit'?'selected':''}>Campus exit</option><option value="zone_entry" ${state.eventType==='zone_entry'?'selected':''}>Zone entry</option><option value="zone_exit" ${state.eventType==='zone_exit'?'selected':''}>Zone exit</option><option value="location_review" ${state.eventType==='location_review'?'selected':''}>Needs review</option><option value="tracking_stale" ${state.eventType==='tracking_stale'?'selected':''}>Session paused</option></select><select class="select-input" id="event-zone"><option value="all">All zones</option>${zones.items.map(z=>`<option value="${z.id}" ${String(state.eventZone)===String(z.id)?'selected':''}>${esc(z.name)}</option>`).join('')}</select></div><span class="student-meta">${events.total} events shown</span></div>${activityTable(events.items,state.user.role!=='student')}<div class="table-bottom"><span>Exact coordinates are not part of the event history.</span><span>Retention: configured by administrator</span></div></section>`;
  }

  async function renderNotifications(){
    const data=await api('/api/notifications');state.notifications=data.items;
    const rows=data.items.length?data.items.map(n=>`<div class="setting-row"><span class="status-icon" style="width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:${n.category==='review'?'#fff0ed':'#edf5ed'};color:${n.category==='review'?'#b45b50':'#4c855c'}">${n.category==='review'?'!':'•'}</span><span class="setting-copy" style="flex:1"><strong>${esc(n.title)}${n.read?'':' · new'}</strong><small>${esc(n.body)}<br>${esc(dateTimeFmt(n.created_at))}</small></span>${n.read?'':`<button class="inline-link" data-action="read-notification" data-id="${n.id}">Mark read</button>`}</div>`).join(''):`<div class="table-empty">No campus notifications yet.</div>`;
    return `${pageHead('Campus alerts','Presence updates and location checks that need attention.',data.unread?'<button class="outline-button" data-action="read-all">Mark all read</button>':'')}<section class="panel privacy-card"><div class="panel-head" style="margin:-16px -16px 12px"><div class="panel-title"><span class="title-icon">${icon('bell')}</span><span><h2>Notifications</h2><small>${data.unread} unread · in-app alerts</small></span></div></div>${rows}</section>`;
  }

  async function renderPrivacy(){
    if(state.user.role==='student'){
      const data=await api('/api/consent');
      return `${pageHead('Privacy & location consent','You decide when the campus app can check your location.')}<div class="privacy-grid"><section class="panel privacy-card"><h2>Your location choice</h2><p>GPS is requested only after you start a presence session. The server checks whether your position is within an active campus zone and discards the raw coordinates.</p><div class="privacy-status"><span class="status-icon">${icon(data.active?'check':'shield')}</span><span><strong>${data.active?'Location consent is active':'Location sharing is off'}</strong>${data.active?'You can stop the session or withdraw consent at any time.':'No location is being requested or shared.'}</span></div><div class="setting-row"><span class="setting-copy"><strong>Consent notice version</strong><small>Consent is recorded with the notice version and timestamp.</small></span><span class="setting-value">${esc(data.policy_version)}</span></div><div class="setting-row"><span class="setting-copy"><strong>Location retention</strong><small>Only zone and event time are retained; exact coordinates are discarded.</small></span><span class="setting-value">No raw GPS</span></div><div class="setting-row"><span class="setting-copy"><strong>Background behavior</strong><small>Location checks run while this page is open and visible. Closing the page pauses tracking.</small></span><span class="setting-value">Foreground only</span></div><div class="modal-actions" style="justify-content:flex-start">${data.active?'<button class="danger-button" data-action="withdraw-consent">Withdraw consent</button>':'<button class="primary-button" data-action="grant-consent">Review and enable location</button>'}</div></section><section class="panel privacy-card"><h2>How presence works</h2><p>Each check compares the current GPS fix with institution-configured geofences. Only zone transitions are recorded.</p><div class="checklist"><div class="check-item"><i>1</i><span>You choose to start a session and accept the notice.</span></div><div class="check-item"><i>2</i><span>Your device asks for location access while the app is open.</span></div><div class="check-item"><i>3</i><span>Vignan receives a check request to verify a configured zone.</span></div><div class="check-item"><i>4</i><span>Raw coordinates are discarded; zone, timestamp, and accuracy are kept.</span></div></div><div class="callout" style="margin-top:13px">Browser GPS can be inaccurate indoors. A low-confidence result goes to review and should not be used alone to penalize a student.</div></section></div>`;
    }
    const [data,staff]=await Promise.all([api('/api/privacy/overview'),api('/api/staff')]);
    const staffRows=staff.items.length?staff.items.map(user=>`<tr><td><div class="student-cell"><span class="avatar">${esc(initials(user.full_name))}</span><span><span class="student-name">${esc(user.full_name)}</span><span class="student-meta">${esc(user.email)}</span></span></div></td><td>${user.role==='admin'?'Administrator':'Security'}</td><td><span class="status-pill ${user.active?'status-inside':'status-review'}">${user.active?'Active':'Disabled'}</span></td><td>${user.id===state.user.id?'<span class="student-meta">Current account</span>':`<button class="edit-link" data-action="toggle-staff" data-id="${user.id}" data-active="${user.active}">${user.active?'Disable access':'Restore access'}</button>`}</td></tr>`).join(''):'<tr><td colspan="4"><div class="table-empty">No campus staff accounts yet.</div></td></tr>';
    return `${pageHead('Privacy & access','Controls for student consent, location retention, and campus data access.',`<button class="outline-button" data-view="activity">View audit trail</button>`)}<div class="privacy-grid"><section class="panel privacy-card"><h2>Location handling</h2><p>The system verifies locations in memory and stores zone-level transitions, not exact coordinates.</p><div class="privacy-stats"><div class="privacy-stat"><strong>${data.active_students}</strong><small>Active student accounts</small></div><div class="privacy-stat"><strong>${data.consented_students}</strong><small>Current consent</small></div><div class="privacy-stat"><strong>${data.without_consent}</strong><small>Not opted in</small></div></div><div class="setting-row"><span class="setting-copy"><strong>Raw GPS coordinates</strong><small>Not written to the database or event audit.</small></span><span class="setting-value">${data.raw_coordinates_stored?'Stored':'Not stored'}</span></div><div class="setting-row"><span class="setting-copy"><strong>Consent policy version</strong><small>New locations require active student consent.</small></span><span class="setting-value">${esc(data.consent_version)}</span></div><div class="setting-row"><span class="setting-copy"><strong>GPS accuracy threshold</strong><small>Checks above this limit are queued for review.</small></span><span class="setting-value">${data.accuracy_limit_m} m</span></div><div class="setting-row"><span class="setting-copy"><strong>Boundary status</strong><small>Sample geofences are blocked in production mode.</small></span><span class="setting-value">${data.demo_geofences?`${data.demo_geofences} sample`: 'No sample fences'}</span></div></section><section class="panel privacy-card"><h2>Event retention</h2><p>${esc(data.retention_note)}</p><label class="field-label" for="retention-days">RETAIN PRESENCE EVENTS FOR</label><select id="retention-days" class="field-select">${[7,14,30,60,90,180,365].map(d=>`<option value="${d}" ${data.retention_days===d?'selected':''}>${d} days</option>`).join('')}</select><div class="field-hint">Old presence events and ended sessions are automatically deleted. Audit summaries do not contain GPS coordinates.</div><button class="primary-button" style="margin-top:14px" data-action="save-retention">Save retention period</button><div class="callout" style="margin-top:15px">Confirm the final retention period and access rules with Vignan’s data owner before enabling real student records.</div></section></div><section class="panel table-panel" style="margin-top:14px"><div class="panel-head"><div class="panel-title"><span class="title-icon">${icon('shield')}</span><span><h2>Campus staff access</h2><small>${staff.total} administrator and security account${staff.total===1?'':'s'}</small></span></div><button class="outline-button" data-action="add-security">${icon('plus')} Add staff account</button></div><div class="data-table-wrap"><table class="data-table"><thead><tr><th>Staff account</th><th>Role</th><th>Status</th><th>Access</th></tr></thead><tbody>${staffRows}</tbody></table></div></section><section class="panel privacy-card" style="margin-top:14px"><h2>Role access</h2><div class="setting-row"><span class="setting-copy"><strong>Campus administrator</strong><small>Manage accounts and geofences, see live occupancy, activity, alerts, and privacy settings.</small></span><span class="setting-value">Full campus scope</span></div><div class="setting-row"><span class="setting-copy"><strong>Campus security</strong><small>See live campus presence, zone counts, alerts, and activity history.</small></span><span class="setting-value">Read presence</span></div><div class="setting-row"><span class="setting-copy"><strong>Student</strong><small>Start or stop personal location sharing and view only their own presence history.</small></span><span class="setting-value">Self scope</span></div></section>`;
  }

  async function renderStudentPresence(){
    const [dash,events,zones,live]=await Promise.all([api('/api/dashboard'),api('/api/presence/events?limit=5'),api('/api/geofences'),api('/api/presence/live')]);
    state.geofences=zones.items;state.liveRows=live.items;
    const inside=dash.current_status==='active';
    if(!inside) state.lastPosition=null;
    const consent=dash.consent?.active;
    const ringVal=inside?100:0;
    const activeZone=dash.current_zone;
    const html=`<div class="page-head"><div><div class="eyebrow"><i></i>MY CAMPUS PRESENCE</div><h1>Welcome, ${esc(state.user.full_name.split(' ')[0])}</h1><p>Your campus presence stays in your control. Share location only during an active session.</p></div><div class="head-actions"><span class="status-pill ${inside?'status-inside':'status-outside'}">${inside?'On campus':'Not verified'}</span></div></div>${consent?`<div class="notice-strip"><span class="notice-icon">i</span><span>Location consent is active. Your latest GPS position appears on the campus map only while your session is active; it is cleared when the session ends.</span><button data-action="privacy-view">Privacy details →</button></div>`:''}<div class="content-grid" style="grid-template-columns:minmax(0,1.3fr) minmax(270px,.8fr)"><section class="student-self-card"><div class="eyebrow"><i></i>VIGNAN · VADLAMUDI CAMPUS</div><h1>Campus presence</h1><p>Start a session when you arrive. Your device checks your location against the active Vignan campus boundary and enabled zones.</p><div class="student-state-row"><i></i>${inside?`Session active · ${esc(activeZone||'Campus boundary')}`:'No active location session'}</div><div class="student-controls">${inside?'<button class="primary-button" data-action="check-now">'+icon('refresh')+' Verify again</button><button class="secondary-button" data-action="stop-tracking">Stop sharing</button>':'<button class="primary-button" data-action="start-session">'+icon('location')+' Start presence session</button>'}<button class="secondary-button" data-action="privacy-view">Privacy settings</button></div></section><section class="panel student-status-panel"><div class="student-status-display"><div class="presence-ring" style="--value:${ringVal}"><span>${inside?'IN':'OUT'}</span></div><div class="student-status-copy"><strong>${inside?'Verified on campus':'Not on campus'}</strong><small>${inside?`Current zone: ${esc(activeZone||'Campus')}`:'No campus presence is being recorded.'}</small><small>${inside?`Last verified ${esc(humanAgo(dash.last_seen_at))}`:'Start a session when you reach an approved zone.'}</small></div></div><div class="student-summary-row"><span>Today’s events</span><strong>${dash.events_today}</strong></div><div class="student-summary-row"><span>Location consent</span><strong>${consent?'Active':'Not enabled'}</strong></div></section></div><section class="panel student-map-panel"><div class="panel-head"><div class="panel-title"><span class="title-icon">${icon('pin')}</span><span><h2>Your campus map</h2><small>Current GPS dot and configured campus zones</small></span></div></div>${mapMarkup(zones.items,live.items,'student-map')}</section><div class="content-grid" style="grid-template-columns:minmax(0,1.3fr) minmax(270px,.8fr)"><section class="panel table-panel"><div class="panel-head"><div class="panel-title"><span class="title-icon">${icon('clock')}</span><span><h2>My recent activity</h2><small>Your presence events only</small></span></div><button class="panel-action" data-view="activity">View all →</button></div>${activityTable(events.items,false)}</section><section class="panel privacy-card"><h2>Before you start</h2><p>The latest precise GPS point is shown to authorized campus administrators and security only while your session is active. It is automatically deleted when your session stops, you withdraw consent, leave campus, sign out, or your session goes stale.</p><div class="checklist"><div class="check-item"><i>✓</i><span>Location checks run only after you accept and grant browser permission</span></div><div class="check-item"><i>✓</i><span>Foreground checks pause when this page is hidden</span></div><div class="check-item"><i>✓</i><span>Stop sharing or withdraw consent at any time</span></div><div class="check-item"><i>✓</i><span>No location history is kept</span></div></div><div class="callout" style="margin-top:13px">${zones.items.some(z=>z.zone_type==='campus'&&z.active)?'Presence checks use the active campus boundary.':'Campus verification is not ready yet. Please contact campus administration.'}</div></section></div>`;
    if(inside&&consent) beginLocationTimer();
    else if(!inside) endLocationTimer();
    return html;
  }

  async function loadView(focus=true){
    if(!state.user||state.loading) return;
    state.loading=true;
    const page=byId('page');
    if(!page){state.loading=false;return;}
    if(focus) page.innerHTML='<div class="loading">Loading campus presence…</div>';
    const crumb=byId('crumb-current');if(crumb)crumb.textContent=state.user.role==='student'&&state.view==='overview'?'My presence':(viewLabels[state.view]||'Overview');
    try{
      const renderer={overview:renderOverview,presence:renderPresence,students:renderStudents,zones:renderZones,activity:renderActivity,notifications:renderNotifications,privacy:renderPrivacy}[state.view] || renderOverview;
      let html=await renderer();
      if(state.view==='privacy') html=updateLiveLocationCopy(html);
      destroyMaps();
      page.innerHTML=html;
      if(state.user.role==='student'&&state.view==='overview') await mountCampusMap('student-map',true);
      else if(state.view==='overview') await mountCampusMap('campus-map');
      else if(state.view==='presence') await mountCampusMap('presence-map');
      if(state.user.role==='student'&&state.view==='overview'&&state.demoLogin) page.insertAdjacentHTML('afterbegin',demoBanner('One-time sample sign-in was shown during workspace setup. Reset its password if you still need access.'));
      page.focus({preventScroll:true});
      refreshNotificationBadge();
    }catch(error){
      page.innerHTML=`<div class="page-head"><div><div class="eyebrow"><i></i>VIGNAN SMART CAMPUS</div><h1>Couldn’t load this view</h1><p>${esc(error.message)}</p></div><button class="primary-button" data-action="refresh">Try again</button></div>`;
    }finally{state.loading=false;}
  }

  function updateLiveLocationCopy(html){
    return html
      .replaceAll('stores zone-level transitions, not exact coordinates.','keeps only the latest exact point during an active session and stores zone transitions; it never stores location history.')
      .replaceAll('discards the raw coordinates.','keeps the latest exact point only while your presence session is active; it does not keep location history.')
      .replaceAll('Only zone and event time are retained; exact coordinates are discarded.','Your latest exact point is shared only during an active session, then deleted.')
      .replaceAll('Raw coordinates are discarded; zone, timestamp, and accuracy are kept.','Your latest exact point is visible to authorized staff only while the session is active; no location history is kept.')
      .replaceAll('<strong>Raw GPS coordinates</strong>','<strong>Live GPS coordinates</strong>')
      .replaceAll('Not written to the database or event audit.','Session-only; deleted when the session ends and never added to event history.')
      .replaceAll('<span class="setting-value">Not stored</span>','<span class="setting-value">Session only</span>');
  }

  async function refreshNotificationBadge(){
    if(!state.user)return;
    try{
      const data=await api('/api/notifications');
      state.notifications=data.items;
      const badge=byId('nav-notification-count');
      const dot=byId('top-notification-dot');
      if(badge){badge.hidden=!data.unread;badge.textContent=data.unread>9?'9+':String(data.unread);}
      if(dot)dot.hidden=!data.unread;
    }catch(_){ }
  }

  function openModal(content){
    modalRoot.innerHTML=`<div class="modal-backdrop" data-action="backdrop"><section class="modal" role="dialog" aria-modal="true">${content}</section></div>`;
    modalRoot.querySelector('input,select,button')?.focus();
  }
  function closeModal(){
    state.mapInstances=state.mapInstances.filter(map=>{
      try{
        const container=typeof map.getContainer==='function'?map.getContainer():map.container;
        if(container&&modalRoot.contains(container)){map.remove();return false;}
      }catch(_){return false;}
      return true;
    });
    modalRoot.innerHTML='';
  }
  function modalHead(title,description){return `<div class="modal-head"><div><h2>${title}</h2><p>${description}</p></div><button class="modal-close" data-action="close-modal" aria-label="Close">×</button></div>`;}

  function showStudentModal(id=null){
    const student=id?null:null;
    if(!id){
      openModal(`${modalHead('Add student account','Create a campus identity for presence verification.')}
        <form data-form="add-student"><div class="modal-body"><label class="field-label" for="new-student-name">FULL NAME</label><input class="field-input" id="new-student-name" name="full_name" required minlength="2" maxlength="140"><label class="field-label" for="new-student-no">STUDENT NUMBER</label><input class="field-input" id="new-student-no" name="student_no" required maxlength="32"><label class="field-label" for="new-student-email">CAMPUS EMAIL</label><input class="field-input" id="new-student-email" name="email" type="email" required><label class="field-label" for="new-student-dept">DEPARTMENT</label><input class="field-input" id="new-student-dept" name="department" required maxlength="120"><label class="field-label" for="new-student-password">TEMPORARY PASSWORD</label><input class="field-input" id="new-student-password" name="password" type="password" required minlength="12" maxlength="72"><div class="field-hint">Share initial sign-in details only through an approved campus channel.</div></div><div class="modal-actions"><button type="button" class="outline-button" data-action="close-modal">Cancel</button><button class="primary-button" type="submit">Create account</button></div></form>`);
      return;
    }
    const s=state.currentStudent;
    if(!s||s.id!==Number(id)){toast('Student record is no longer available. Refresh the list.',true);return;}
    openModal(`${modalHead('Manage student account',`${esc(s.student_no||'')} · update access or reset password.`)}<form data-form="edit-student" data-id="${s.id}"><div class="modal-body"><label class="field-label" for="edit-student-name">FULL NAME</label><input class="field-input" id="edit-student-name" name="full_name" value="${esc(s.full_name)}" required><label class="field-label" for="edit-student-dept">DEPARTMENT</label><input class="field-input" id="edit-student-dept" name="department" value="${esc(s.department||'')}" required><label class="field-label" for="edit-student-password">RESET PASSWORD (OPTIONAL)</label><input class="field-input" id="edit-student-password" name="password" type="password" minlength="12" maxlength="72" placeholder="Leave blank to keep current password"><label class="consent-box"><input type="checkbox" name="active" ${s.active?'checked':''}><span>Account is active and can sign in to the student presence view.</span></label></div><div class="modal-actions"><button type="button" class="outline-button" data-action="close-modal">Cancel</button><button class="primary-button" type="submit">Save changes</button></div></form>`);
  }
  function showSecurityModal(){
    openModal(`${modalHead('Add campus staff account','Administrators manage student accounts and boundaries. Security users monitor live presence and campus activity.')}
      <form data-form="add-security"><div class="modal-body"><label class="field-label" for="security-name">FULL NAME</label><input class="field-input" id="security-name" name="full_name" required><label class="field-label" for="security-email">CAMPUS EMAIL</label><input class="field-input" id="security-email" name="email" type="email" required><label class="field-label" for="staff-role">ACCESS ROLE</label><select class="field-select" id="staff-role" name="role"><option value="security">Campus security</option><option value="admin">Campus administrator</option></select><label class="field-label" for="security-password">TEMPORARY PASSWORD</label><input class="field-input" id="security-password" name="password" type="password" required minlength="12" maxlength="72"></div><div class="modal-actions"><button type="button" class="outline-button" data-action="close-modal">Cancel</button><button class="primary-button" type="submit">Create staff access</button></div></form>`);
  }

  function showZoneModal(id=null){
    const z=id?state.geofences.find(x=>x.id===Number(id)):null;
    const coord=z?{lat:Number(z.latitude),lon:Number(z.longitude)}:{lat:16.232529,lon:80.547941};
    const title=z?'Configure geo-zone':'Add geo-zone';
    openModal(`${modalHead(title,'Use a surveyed center and radius. An active campus boundary is required before adding sub-zones.')}
      <form data-form="zone" data-id="${z?z.id:''}"><div class="modal-body form-grid"><div class="full"><label class="field-label" for="zone-name">ZONE NAME</label><input class="field-input" id="zone-name" name="name" required maxlength="120" value="${esc(z?.name||'')}"></div><div><label class="field-label" for="zone-type">ZONE TYPE</label><select class="field-select" id="zone-type" name="zone_type"><option value="campus" ${z?.zone_type==='campus'||!z?'selected':''}>Campus boundary</option><option value="academic" ${z?.zone_type==='academic'?'selected':''}>Academic block</option><option value="library" ${z?.zone_type==='library'?'selected':''}>Library</option><option value="hostel" ${z?.zone_type==='hostel'?'selected':''}>Hostel</option><option value="sports" ${z?.zone_type==='sports'?'selected':''}>Sports</option><option value="transport" ${z?.zone_type==='transport'?'selected':''}>Transport</option><option value="health" ${z?.zone_type==='health'?'selected':''}>Health centre</option><option value="other" ${z?.zone_type==='other'?'selected':''}>Other</option></select></div><div><label class="field-label" for="zone-radius">RADIUS (METRES)</label><input class="field-input" id="zone-radius" name="radius_m" type="number" min="25" max="5000" step="5" value="${z?.radius_m||600}" required></div><div><label class="field-label" for="zone-lat">LATITUDE</label><input class="field-input" id="zone-lat" name="latitude" type="number" step="0.0000001" min="-90" max="90" value="${coord.lat}" required></div><div><label class="field-label" for="zone-lon">LONGITUDE</label><input class="field-input" id="zone-lon" name="longitude" type="number" step="0.0000001" min="-180" max="180" value="${coord.lon}" required></div><label class="consent-box full"><input type="checkbox" name="active" ${z?.active||!z?'checked':''}><span>Zone is active and may be used to verify student presence.</span></label><label class="consent-box full"><input type="checkbox" name="boundary_verified" ${z&&!z.demo_boundary?'checked':''}><span>I confirm these coordinates and radius come from a surveyed and institution-approved Vignan campus boundary. Unverified zones are marked as sample configuration.</span></label><label class="consent-box"><input type="checkbox" name="alert_entry" ${z?.alert_entry!==false?'checked':''}><span>Notify on entry</span></label><label class="consent-box"><input type="checkbox" name="alert_exit" ${z?.alert_exit!==false?'checked':''}><span>Notify on exit</span></label></div><div class="modal-actions"><button type="button" class="outline-button" data-action="close-modal">Cancel</button><button class="primary-button" type="submit">${z?'Save zone':'Create zone'}</button></div></form>`);
    const pickerWrap=document.createElement('div');
    pickerWrap.className='full zone-map-field';
    pickerWrap.innerHTML='<div class="field-hint">Click the real map or drag the pin to set the zone center. Adjust the radius above.</div><div id="zone-map-picker" class="zone-map-picker"></div>';
    modalRoot.querySelector('form[data-form="zone"] .modal-body')?.append(pickerWrap);
    requestAnimationFrame(()=>mountZonePicker([coord.lat,coord.lon]));
  }

  async function getPosition(){
    if(!window.isSecureContext){throw new Error('Location requires HTTPS or localhost. Open this app from the secure campus URL.');}
    if(!navigator.geolocation) throw new Error('This browser does not provide location access.');
    return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,error=>{
      if(error.code===1) reject(new Error('Location permission was not granted. You can enable it in your browser if you choose.'));
      else if(error.code===2) reject(new Error('Your device could not determine its location. Move to an open area and try again.'));
      else reject(new Error('Location timed out. Check device location services and retry.'));
    },{enableHighAccuracy:true,timeout:15000,maximumAge:10000}));
  }
  async function sendLocation(direction,quiet=false){
    const position=await getPosition();
    const coords=position.coords;
    if(state.user?.role==='student') state.lastPosition={latitude:coords.latitude,longitude:coords.longitude,accuracy_m:coords.accuracy};
    const body={latitude:coords.latitude,longitude:coords.longitude,accuracy_m:coords.accuracy,direction};
    const result=await postJson('/api/presence/check',body);
    body.latitude=0;body.longitude=0; // drop references as soon as the server has replied
    if(result.status==='verified'||result.status==='still_inside'){
      beginLocationTimer();
      if(!quiet)toast(result.message||'Presence verified.');
    }else if(result.status==='exited'||result.status==='outside'||result.status==='needs_review'){
      endLocationTimer();
      state.lastPosition=null;
      if(!quiet)toast(result.message||'Presence updated.');
    }
    return result;
  }
  function beginLocationTimer(){
    if(state.locationTimer)return;
    state.tracking=true;
    state.locationTimer=setInterval(async()=>{
      if(document.hidden||!state.tracking)return;
      try{
        const result=await sendLocation('update',true);
        if(result.status==='exited'||result.status==='outside'||result.status==='needs_review'){
          endLocationTimer();
          await loadView(false);
        }else{
          await loadView(false);
        }
      }catch(error){if(error.message.includes('permission')){endLocationTimer();toast(error.message,true);}}
    },30000);
  }
  function onVisibilityChange(){
    if(!state.tracking||document.hidden)return;
    sendLocation('update',true).then(()=>loadView(false)).catch(error=>toast(error.message,true));
  }
  document.addEventListener('visibilitychange',onVisibilityChange);
  function endLocationTimer(){
    if(state.locationTimer)clearInterval(state.locationTimer);
    state.locationTimer=null;state.tracking=false;
  }
  function consentModal(){
    openModal(`${modalHead('Before you share location','Vignan Smart Campus will use your device location to verify you are inside a configured campus zone.')}
      <div class="modal-body"><div class="privacy-status"><span class="status-icon">${icon('lock')}</span><span><strong>One clear purpose: campus presence</strong>Your latest precise GPS point is available to authorized campus administrators and security only while your presence session is active. No route or location history is kept.</span></div><div class="checklist"><div class="check-item"><i>1</i><span>Location access begins only after you accept and your browser grants permission.</span></div><div class="check-item"><i>2</i><span>Checks run while this page is visible. Exact location is cleared when you stop, withdraw consent, exit, sign out, or the session goes stale.</span></div><div class="check-item"><i>3</i><span>You can stop the session or withdraw consent at any time.</span></div></div><label class="consent-box"><input id="consent-accept" type="checkbox"><span>I have read this notice and choose to enable location checks for my campus presence.</span></label></div><div class="modal-actions"><button class="outline-button" data-action="close-modal">Cancel</button><button class="primary-button" data-action="confirm-consent">Continue</button></div>`);
  }

  async function signOut(show=true,callApi=true){
    endLocationTimer();
    try{if(state.user&&callApi)await postJson('/api/auth/logout',{});}catch(_){ }
    state.lastPosition=null;state.user=null;state.view=null;state.demoLogin=null;destroyMaps();
    if(show)toast('You have signed out.');
    start();
  }

  async function loadExport(){
    const response=await fetch(`/api/reports/presence.csv?event_type=${encodeURIComponent(state.eventType)}`,{credentials:'same-origin',headers:{'X-CSRF-Token':decodeURIComponent(cookie('vignan_csrf'))}});
    if(!response.ok){let msg='Could not export presence history.';try{msg=(await response.json()).detail||msg;}catch(_){}throw new Error(msg);}
    const blob=await response.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='vignan-campus-presence.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Presence history exported.');
  }

  async function start(){
    try{
      const setup=await api('/api/setup/status');
      if(setup.setup_required){showAuth('setup','',null,{bootstrapTokenRequired:setup.bootstrap_token_required,sampleDataAvailable:setup.sample_data_available===true});return;}
      const result=await api('/api/auth/me');
      state.user=result.user;
      state.view=state.user.role==='student'?'overview':'overview';
      renderShell();
    }catch(error){
      showAuth('login',error.message==='Sign in to continue.'?'':error.message);
    }
  }

  document.addEventListener('submit',async event=>{
    const form=event.target.closest('form[data-form]');if(!form)return;
    event.preventDefault();
    const formData=new FormData(form);const kind=form.dataset.form;
    const submit=form.querySelector('[type="submit"]');if(submit)submit.disabled=true;
    try{
      if(kind==='login'){
        const result=await postJson('/api/auth/login',{email:formData.get('email'),password:formData.get('password')});
        state.user=result.user;state.view='overview';renderShell();toast('Signed in.');
      }else if(kind==='setup'){
        const result=await postJson('/api/setup',{full_name:formData.get('full_name'),email:formData.get('email'),password:formData.get('password'),campus_name:formData.get('campus_name'),seed_sample:formData.get('seed_sample')==='on',bootstrap_token:formData.get('bootstrap_token')||''});
        state.user=result.user;state.view='overview';state.demoLogin=result.demo_student_login||null;renderShell();
        if(state.demoLogin) openModal(`${modalHead('Workspace created','Copy this one-time synthetic student sign-in if you want to try the student screen. The password will not be shown again.')}
          <div class="demo-credential">${esc(state.demoLogin.student_email)}<br>${esc(state.demoLogin.student_password)}</div><div class="field-hint" style="margin-top:8px">This account and its records are fictional. Production setup must use approved Vignan accounts and surveyed geofences.</div><div class="modal-actions"><button class="primary-button" data-action="close-modal">Done</button></div>`);
        toast('Campus workspace initialized.');
      }else if(kind==='add-student'){
        await postJson('/api/students',{full_name:formData.get('full_name'),student_no:formData.get('student_no'),email:formData.get('email'),department:formData.get('department'),password:formData.get('password')});
        closeModal();toast('Student account created.');await loadView(false);
      }else if(kind==='edit-student'){
        const body={full_name:formData.get('full_name'),department:formData.get('department'),active:formData.get('active')==='on'};
        if(formData.get('password'))body.password=formData.get('password');
        await postJson(`/api/students/${form.dataset.id}`,body,'PATCH');closeModal();toast('Student account updated.');await loadView(false);
      }else if(kind==='add-security'){
        await postJson('/api/staff',{full_name:formData.get('full_name'),email:formData.get('email'),password:formData.get('password'),role:formData.get('role')});
        closeModal();toast('Staff account created.');
      }else if(kind==='zone'){
        const body={name:formData.get('name'),zone_type:formData.get('zone_type'),latitude:Number(formData.get('latitude')),longitude:Number(formData.get('longitude')),radius_m:Number(formData.get('radius_m')),active:formData.get('active')==='on',boundary_verified:formData.get('boundary_verified')==='on',alert_entry:formData.get('alert_entry')==='on',alert_exit:formData.get('alert_exit')==='on'};
        const zoneId=form.dataset.id;
        await postJson(zoneId?`/api/geofences/${zoneId}`:'/api/geofences',body,zoneId?'PATCH':'POST');
        closeModal();toast('Geo-zone saved.');await loadView(false);
      }
    }catch(error){if(kind==='setup'&&error.message.toLowerCase().includes('already initialized'))showAuth('login','This workspace is already initialized. Sign in with the campus administrator account.');else toast(error.message,true);}finally{if(submit&&submit.isConnected)submit.disabled=false;}
  });

  document.addEventListener('click',async event=>{
    const view=event.target.closest('[data-view]');
    if(view){event.preventDefault();state.view=view.dataset.view;state.menuOpen=false;document.querySelector('.popover-menu')?.remove();const sidebar=byId('sidebar');sidebar?.classList.remove('menu-open');await loadView();return;}
    const actionEl=event.target.closest('[data-action]');if(!actionEl)return;
    const action=actionEl.dataset.action;
    try{
      if(action==='show-setup'){showAuth('setup');}
      else if(action==='close-modal')closeModal();
      else if(action==='backdrop'&&event.target.classList.contains('modal-backdrop'))closeModal();
      else if(action==='refresh'){await loadView();toast('Campus view refreshed.');}
      else if(action==='add-student')showStudentModal();
      else if(action==='add-security')showSecurityModal();
      else if(action==='show-demo-data'){
        openModal(`${modalHead('Load synthetic demo data?','This adds fictional students, sample presence events, and demo geofences to the live production database.')}
          <div class="modal-body"><div class="notice-strip danger"><span class="notice-icon">!</span><span>These records are not real attendance. They will appear in dashboards and cannot be loaded twice. Production blocks presence verification against demo boundaries.</span></div></div>
          <div class="modal-actions"><button class="outline-button" data-action="close-modal">Cancel</button><button class="danger-button" data-action="confirm-demo-data">Load demo data</button></div>`);
      }
      else if(action==='confirm-demo-data'){
        actionEl.disabled=true;
        const result=await postJson('/api/demo-data',{});
        state.demoLogin=result.demo_student_login||null;
        closeModal();
        await loadView(false);
        if(state.demoLogin){
          openModal(`${modalHead('Demo data loaded','Use this synthetic student sign-in to test the student screen. Save these credentials now; the password will not be shown again.')}
            <div class="demo-credential">${esc(state.demoLogin.student_email)}<br>${esc(state.demoLogin.student_password)}</div>
            <div class="field-hint" style="margin-top:8px">Fictional account only. Demo data appears in production dashboards and must not be used as attendance evidence.</div>
            <div class="modal-actions"><button class="primary-button" data-action="close-modal">Done</button></div>`);
        }
        toast(result.warning||'Synthetic demo data loaded.');
      }
      else if(action==='toggle-staff'){const active=actionEl.dataset.active==='true';await postJson(`/api/staff/${actionEl.dataset.id}`,{active:!active},'PATCH');toast(active?'Staff access disabled.':'Staff access restored.');await loadView(false);}
      else if(action==='edit-student'){
        const response=await api('/api/students?q='+encodeURIComponent(state.studentSearch));
        state.currentStudent=response.items.find(s=>s.id===Number(actionEl.dataset.id));showStudentModal(actionEl.dataset.id);
      }
      else if(action==='add-zone')showZoneModal();
      else if(action==='edit-zone')showZoneModal(actionEl.dataset.id);
      else if(action==='toggle-zone'){
        const zone=state.geofences.find(z=>z.id===Number(actionEl.dataset.id));if(!zone)throw new Error('Geo-zone not found.');
        const body={name:zone.name,zone_type:zone.zone_type,latitude:Number(zone.latitude),longitude:Number(zone.longitude),radius_m:zone.radius_m,active:!zone.active,boundary_verified:!zone.demo_boundary,alert_entry:zone.alert_entry,alert_exit:zone.alert_exit};
        await postJson(`/api/geofences/${zone.id}`,body,'PATCH');toast(`${zone.name} ${body.active?'enabled':'paused'}.`);await loadView(false);
      }
      else if(action==='export')await loadExport();
      else if(action==='read-notification'){await postJson(`/api/notifications/${actionEl.dataset.id}/read`,{});await loadView(false);}
      else if(action==='read-all'){await postJson('/api/notifications/read-all',{});await loadView(false);toast('All alerts marked as read.');}
      else if(action==='save-retention'){const days=Number(byId('retention-days').value);await postJson('/api/privacy/retention',{days},'PUT');toast('Presence retention period saved.');await loadView(false);}
      else if(action==='start-session')consentModal();
      else if(action==='confirm-consent'){
        if(!byId('consent-accept')?.checked){toast('Please confirm the location notice before continuing.',true);return;}
        await postJson('/api/consent',{granted:true,policy_version:CONSENT_VERSION},'PUT');closeModal();
        const result=await sendLocation('check_in');if(result.status==='outside')toast(result.message,true);await loadView(false);
      }
      else if(action==='check-now'){
        const result=await sendLocation('update');if(result.status==='outside'||result.status==='needs_review')toast(result.message,true);await loadView(false);
      }
      else if(action==='stop-tracking'){
        endLocationTimer();state.lastPosition=null;const result=await postJson('/api/presence/stop',{});toast(result.message);await loadView(false);
      }
      else if(action==='grant-consent')consentModal();
      else if(action==='withdraw-consent'){
        openModal(`${modalHead('Withdraw location consent?','This stops your active presence session and prevents new location checks.') }<div class="modal-actions"><button class="outline-button" data-action="close-modal">Keep consent</button><button class="danger-button" data-action="confirm-withdraw">Withdraw consent</button></div>`);
      }
      else if(action==='confirm-withdraw'){
        endLocationTimer();state.lastPosition=null;await postJson('/api/consent',{granted:false,policy_version:CONSENT_VERSION},'PUT');closeModal();toast('Location consent withdrawn.');await loadView(false);
      }
      else if(action==='privacy-view'){state.view='privacy';await loadView();}
      else if(action==='account-menu'){
        document.querySelector('.popover-menu')?.remove();
        const menu=document.createElement('div');menu.className='popover-menu';menu.innerHTML=`<button data-action="account-details">${icon('user')} ${esc(state.user.full_name)}</button>${state.user.role==='student'?'<button data-view="privacy">'+icon('shield')+' Privacy & consent</button>':''}<button data-action="logout">${icon('exit')} Sign out</button>`;document.body.append(menu);
      }
      else if(action==='account-details')toast(`${state.user.email} · ${state.user.role}`);
      else if(action==='logout'){document.querySelector('.popover-menu')?.remove();await signOut();}
      else if(action==='mobile-menu'){byId('sidebar')?.classList.toggle('menu-open');}
    }catch(error){toast(error.message,true);}
  });

  document.addEventListener('input',event=>{
    if(event.target.id==='student-search'){
      state.studentSearch=event.target.value;
      clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>loadView(false),220);
    }else if(event.target.id==='live-search'){
      state.studentSearch=event.target.value;
      clearTimeout(state.searchTimer);state.searchTimer=setTimeout(async()=>{
        try{const zone=byId('live-zone-filter')?.value||'all';const data=await api(`/api/presence/live?q=${encodeURIComponent(state.studentSearch)}${zone!=='all'?`&zone_id=${zone}`:''}`);state.liveRows=data.items;const node=byId('live-table');if(node)node.innerHTML=liveTable(data.items,true);}catch(err){toast(err.message,true);}
      },200);
    }else if(event.target.id==='event-search'){
      state.eventSearch=event.target.value;
      clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>loadView(false),220);
    }
  });
  document.addEventListener('change',async event=>{
    if(event.target.id==='student-status'){state.studentStatus=event.target.value;await loadView(false);}
    else if(event.target.id==='event-type'){state.eventType=event.target.value;await loadView(false);}
    else if(event.target.id==='event-zone'){state.eventZone=event.target.value;await loadView(false);}
    else if(event.target.id==='live-zone-filter'){
      const q=byId('live-search')?.value||'';const val=event.target.value;
      try{const data=await api(`/api/presence/live?q=${encodeURIComponent(q)}${val!=='all'?`&zone_id=${val}`:''}`);state.liveRows=data.items;const node=byId('live-table');if(node)node.innerHTML=liveTable(data.items,true);}catch(err){toast(err.message,true);}
    }
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeModal();document.querySelector('.popover-menu')?.remove();}});

  start();
})();
