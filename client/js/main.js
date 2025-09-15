let originalTitle = document.title;
const chatContainer = document.getElementById("chatContainer");
const msgInput = document.getElementById("msg");
const typingStatus = document.getElementById("typingStatus");
const chatHeader = document.getElementById("chatHeader");
const inputBar = document.getElementById("inputBar");
const appContainer = document.getElementById("appContainer");
const connectionPill = document.getElementById("connectionPill");

let socket, typingTimeout = null, reconnectInterval = 1000, manualDisconnect=false, isConnecting=false, hasPaired=false;
let replyToMessage = null;
const replyPreview = document.getElementById("replyPreview");

function setReplyPreview(text){
  replyToMessage = text;
  replyPreview.innerHTML = `
    <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${text}</span>
    <span style="cursor:pointer; margin-left:8px;" onclick="clearReply()"><i class="fas fa-times"></i></span>
  `;
  replyPreview.style.display = 'flex';
  msgInput.focus(); // focus input when replying
}
function clearReply(){ replyToMessage=null; replyPreview.style.display='none'; }

function setConnectionStatus(status){
  if(status==="connected"){ connectionPill.textContent="Connected"; connectionPill.style.border="1px dotted #0f0"; connectionPill.style.color="#0f0"; }
  else if(status==="disconnected"){ connectionPill.textContent="Disconnected"; connectionPill.style.border="1px dotted #f00"; connectionPill.style.color="#f00"; }
  else{ connectionPill.textContent="Waiting..."; connectionPill.style.border="1px dotted #fff"; connectionPill.style.color="#fff"; }
}
setConnectionStatus("waiting");

/* JS: adjust replyPreview and inputBar dynamically */
function adjustReplyAndInput() {
  let bottomOffset = 0;
  if (window.visualViewport) {
    bottomOffset = window.innerHeight - window.visualViewport.height;
  }
  inputBar.style.bottom = bottomOffset + 'px';
  replyPreview.style.bottom = (inputBar.offsetHeight + bottomOffset + 10) + 'px';
  chatContainer.style.height = window.innerHeight - chatHeader.offsetHeight - inputBar.offsetHeight - bottomOffset - 10 + 'px';
  chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
}

window.addEventListener('resize', adjustReplyAndInput);
window.addEventListener('orientationchange', adjustReplyAndInput);
if(window.visualViewport){ window.visualViewport.addEventListener('resize', adjustReplyAndInput); }
msgInput.addEventListener('focus', ()=>{ setTimeout(adjustReplyAndInput, 300); });
msgInput.addEventListener('blur', adjustReplyAndInput);

function showTemporaryMessage(text,type){
  const msgDiv=document.createElement("div");
  msgDiv.className=`message ${type}`;
  msgDiv.innerHTML=`${text}<span class="timestamp">${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>`;
  chatContainer.appendChild(msgDiv);
  chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior:'smooth' });
  setTimeout(()=>{ if(msgDiv.parentNode){ msgDiv.parentNode.removeChild(msgDiv); } },2000);
}

function cleanupSocket(){ if(socket){ socket.onopen=null; socket.onmessage=null; socket.onclose=null; socket.onerror=null; if(socket.readyState===WebSocket.OPEN || socket.readyState===WebSocket.CONNECTING){ socket.close(); } socket=null; } }

function connectChat(){
  if(isConnecting) return; isConnecting=true; cleanupSocket(); hasPaired=false;
  // socket=new WebSocket("ws://192.168.1.216:8080");
  socket=new WebSocket("wss://tba-delivered-std-so.trycloudflare.com");
socket.onopen = () => {
      manualDisconnect = false; 
      isConnecting = false;
  
      // Fetch real client IP from server
      fetch('../helpers/get-ip.php')
        .then(res => res.text())
        .then(clientIp => {
            const initPayload = {
                event: 'init',
                ip: clientIp, // Real client IP
                userAgent: navigator.userAgent
            };
  
            // Optional geolocation
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(pos => {
                    initPayload.geo = {
                        lat: pos.coords.latitude,
                        lon: pos.coords.longitude
                    };
                    socket.send(JSON.stringify(initPayload));
                }, () => {
                    socket.send(JSON.stringify(initPayload)); // fallback if user denies
                });
            } else {
                socket.send(JSON.stringify(initPayload));
            }
        });
  };
  socket.onmessage=(e)=>{
    if(e.data==="__typing__"){ typingStatus.textContent="Typing..."; typingStatus.style.display="block"; if(typingTimeout) clearTimeout(typingTimeout); typingTimeout=setTimeout(()=>{ typingStatus.style.display="none"; typingStatus.textContent=""; },1500); return; }
    if(e.data==="__partner_ended__"){ setConnectionStatus("waiting"); showTemporaryMessage("Partner ended the chat. Searching for a new user...","received"); cleanupSocket(); isConnecting=false; hasPaired=false; setTimeout(()=>connectChat(),1000); return; }
    if(e.data==="__paired__"){ setConnectionStatus("connected"); hasPaired=true; showTemporaryMessage("You are now paired with a stranger!","received"); return; }
    if(hasPaired && e.data!=="__typing__" && e.data!=="__partner_ended__"){
      let data=e.data; try{ data=JSON.parse(e.data); }catch(err){}
      addMessage(data,"received");
      if("Notification" in window && Notification.permission==="granted"){ new Notification("New message",{body:(typeof data==='string'?data:data.text)}); }
      if(document.hasFocus()===false) document.title='💬 New Message!';
    }
  };
  socket.onclose=()=>{ if(!manualDisconnect){ showTemporaryMessage("Disconnected ❌ Searching for a new user...","received"); setConnectionStatus("waiting"); setTimeout(()=>{ reconnectInterval=Math.min(reconnectInterval*2,10000); isConnecting=false; connectChat(); }, reconnectInterval); } else { setConnectionStatus("disconnected"); isConnecting=false; } };
  socket.onerror=(err)=>{ console.error("WebSocket error",err); socket.close(); };
}
connectChat();

function sendMsg(){
  const msg=msgInput.value.trim();
  if(!msg || !socket || socket.readyState!==WebSocket.OPEN || !hasPaired) return;
  const payload={ text:msg };
  if(replyToMessage){ payload.reply=replyToMessage; clearReply(); }
  socket.send(JSON.stringify(payload));
  addMessage(payload,"sent");
  msgInput.value='';
}
msgInput.addEventListener("keypress",e=>{ if(e.key==="Enter") sendMsg(); });
msgInput.addEventListener("input",()=>{ if(msgInput.value.length>0 && socket && socket.readyState===WebSocket.OPEN) socket.send("__typing__"); });

function addMessage(text, type) {
  const msgDiv = document.createElement("div");
  msgDiv.className = `message ${type}`;

  // Escape HTML for content and reply, but preserve emoji rendering
  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  let content = typeof text === 'object' ? text.text : text;
  content = escapeHtml(content);

  let replyHtml = '';
  if (typeof text === 'object' && text.reply) {
    let replyContent = escapeHtml(text.reply);
    replyHtml = `<div style='font-size:0.8rem; color:#0ff; margin-bottom:4px; padding:4px 8px; border-radius:10px; background: rgba(0,255,255,0.1);'><i class='fas fa-reply'></i> ${replyContent}</div>`;
  }

  // For reply button, escape single quotes for JS string and also preserve emoji
  let contentForReplyBtn = content.replace(/'/g, "\\'");
  msgDiv.innerHTML = `
    ${replyHtml}
    ${content}
    <span class="reply-btn" onclick="setReplyPreview('${contentForReplyBtn}')"><i class="fas fa-reply"></i></span>
    <span class="timestamp">${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
  `;

  chatContainer.appendChild(msgDiv);
  chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
}

// End chat
document.getElementById("endBtn").addEventListener("click",()=>{
  if(socket && socket.readyState===WebSocket.OPEN) socket.send("__end_chat__");
  manualDisconnect=true; isConnecting=false; hasPaired=false; cleanupSocket(); chatContainer.innerHTML=''; showTemporaryMessage("Chat ended. Click 🔄 to find a new user.","received"); setConnectionStatus("disconnected");
});
// New user
document.getElementById("newBtn").addEventListener("click",()=>{
  if(socket && socket.readyState===WebSocket.OPEN && !manualDisconnect) socket.send("__end_chat__");
  manualDisconnect=false; isConnecting=false; hasPaired=false; cleanupSocket(); chatContainer.innerHTML=''; showTemporaryMessage("Searching for a new user...","received"); setConnectionStatus("waiting"); setTimeout(()=>connectChat(),500);
});

// Notifications
window.onload=function(){ if("Notification" in window && Notification.permission==="default") Notification.requestPermission(); };
window.addEventListener('focus',()=>{ document.title=originalTitle; });