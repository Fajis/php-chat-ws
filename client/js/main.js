let originalTitle = document.title;
const chatContainer = document.getElementById("chatContainer");
const msgInput = document.getElementById("msg");
const typingStatus = document.getElementById("typingStatus");
const chatHeader = document.getElementById("chatHeader");
const inputBar = document.getElementById("inputBar");
const appContainer = document.getElementById("appContainer");
const connectionPill = document.getElementById("connectionPill");
const replyPreview = document.getElementById("replyPreview");
const voiceBtn = document.getElementById("voiceBtn");
const muteBtn = document.getElementById("muteRemoteBtn");
const voicePopup = document.getElementById("voicePopup");
const muteIndicator = document.getElementById("muteIndicator");

let socket, typingTimeout = null, reconnectInterval = 1000;
let manualDisconnect=false, isConnecting=false, hasPaired=false;
let replyToMessage = null;
let unreadMessage = false;

let localStream = null;
let peerConnection = null;
let remoteAudio = document.getElementById("remoteAudio");
if(!remoteAudio){
    remoteAudio = document.createElement("audio");
    remoteAudio.id="remoteAudio";
    remoteAudio.autoplay=true;
    remoteAudio.style.display="none";
    document.body.appendChild(remoteAudio);
}

let isTalking = false;
let isRemoteMuted = false;

const statusDots = { connected:'🟢', waiting:'⚪', disconnected:'🔴' };

// ===== Functions =====
function updateTitle(status){
    let dot = statusDots[status] || '⚪';
    let newMsg = unreadMessage ? '💬 ' : '';
    document.title = `${dot} ${newMsg}${originalTitle}`;
}
function showTemporaryMessage(text, type){
    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${type}`;
    msgDiv.textContent = text;
    chatContainer.appendChild(msgDiv);
    chatContainer.scrollTo({top: chatContainer.scrollHeight, behavior: "smooth"});
    // Remove after 2 seconds
    setTimeout(()=>{ if(msgDiv.parentNode) msgDiv.parentNode.removeChild(msgDiv); }, 2000);
}
function setConnectionStatus(status){
    if(status==="connected"){ 
        connectionPill.textContent="Connected"; 
        connectionPill.style.border="1px dotted #0f0"; 
        connectionPill.style.color="#0f0"; 
    } else if(status==="disconnected"){ 
        connectionPill.textContent="Disconnected"; 
        connectionPill.style.border="1px dotted #f00"; 
        connectionPill.style.color="#f00"; 
    } else{ 
        connectionPill.textContent="Waiting..."; 
        connectionPill.style.border="1px dotted #fff"; 
        connectionPill.style.color="#fff"; 
    }
    updateTitle(status);
}
function safeSend(data){
    if(socket && socket.readyState === WebSocket.OPEN){
        socket.send(JSON.stringify(data));
    } else {
        console.warn("WebSocket not open yet. Message not sent:", data);
    }
}

function cleanupSocket(){
    if(socket){
        socket.onopen=null;
        socket.onmessage=null;
        socket.onclose=null;
        socket.onerror=null;
        if(socket.readyState===WebSocket.OPEN || socket.readyState===WebSocket.CONNECTING) socket.close();
        socket=null;
    }
}

// ===== Connect Chat =====
function connectChat(){
    if(isConnecting) return; 
    isConnecting=true;
    cleanupSocket();
    hasPaired=false;
    socket=new WebSocket("wss://php-chat-ws-1.onrender.com");

    socket.onopen = () => {
        manualDisconnect = false;
        isConnecting = false;
        fetch('../helpers/get-ip.php')
            .then(res => res.text())
            .then(clientIp => {
                const initPayload = { event:'init', ip: clientIp, userAgent: navigator.userAgent };
                if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(pos => {
                        initPayload.geo = { lat: pos.coords.latitude, lon: pos.coords.longitude };
                        safeSend(initPayload);
                    }, () => safeSend(initPayload));
                } else {
                    safeSend(initPayload);
                }
            });
    };

    window.lastNotificationTime = 0;

    socket.onmessage = e => {
        // Handle typing
        if(e.data === "__typing__"){
            typingStatus.textContent = "Typing...";
            typingStatus.style.display = "block";
            if(typingTimeout) clearTimeout(typingTimeout);
            typingTimeout = setTimeout(()=>{
                typingStatus.style.display = "none";
                typingStatus.textContent = "";
            }, 1500);
            return;
        }
    
        // Partner ended chat
        if(e.data === "__partner_ended__"){
            setConnectionStatus("waiting");
            showTemporaryMessage("Partner ended the chat. Searching for a new user...", "received");
            cleanupSocket();
            isConnecting = false;
            hasPaired = false;
            setTimeout(()=>connectChat(), 1000);
            return;
        }
    
        // Paired event
        if(e.data === "__paired__"){
            setConnectionStatus("connected");
            hasPaired = true;
            showTemporaryMessage("You are now paired with a stranger!", "received");
            return;
        }
    
        // Handle JSON messages
        try{
            const jsonData = JSON.parse(e.data);
    
            // Speaking popup
            if(jsonData.type === "speaking"){
                if(voicePopup) voicePopup.style.display = jsonData.speaking && !isRemoteMuted ? "flex" : "none";
                return; // <- important: stop further processing
            }
    
            // Remote mute indicator
            if(jsonData.type === "muted"){
                if(muteIndicator) muteIndicator.style.display = jsonData.muted ? "flex" : "none";
                return; // <- stop further processing
            }
    
            // WebRTC signaling
            if(["offer","answer","ice"].includes(jsonData.type)){
                handleSignaling(jsonData);
                return; // skip chat
            }
    
            // Only actual chat messages reach addMessage
            if(hasPaired && jsonData.text){
                addMessage(jsonData, "received");
                unreadMessage = true;
                updateTitle(getCurrentStatus());
            }
    
        } catch(err){
            // If parsing fails, assume plain text chat message
            if(hasPaired && typeof e.data === "string"){
                addMessage(e.data, "received");
                unreadMessage = true;
                updateTitle(getCurrentStatus());
            }
        }
    };

    socket.onclose = () => {
        if(!manualDisconnect){
            showTemporaryMessage("Disconnected ❌ Searching for a new user...","received");
            setConnectionStatus("waiting");
            setTimeout(()=>{ reconnectInterval=Math.min(reconnectInterval*2,10000); isConnecting=false; connectChat(); }, reconnectInterval);
        } else setConnectionStatus("disconnected");
    };
    socket.onerror = err => { console.error("WebSocket error",err); socket.close(); };
}
connectChat();

// ===== Send & Receive Messages =====
function sendMsg(){
    const msg = msgInput.value.trim();
    if(!msg || !socket || socket.readyState!==WebSocket.OPEN || !hasPaired) return;
    const payload={ text:msg };
    if(replyToMessage){ payload.reply=replyToMessage; replyToMessage=null; replyPreview.style.display='none'; }
    socket.send(JSON.stringify(payload));
    addMessage(payload,"sent");
    msgInput.value='';
}

function addMessage(text,type){
    const msgDiv=document.createElement("div");
    msgDiv.className=`message ${type}`;

    function escapeHtml(str){ 
        return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); 
    }

    // Ensure content is always a string
    let content = typeof text === 'object' ? (text.text || '') : (text || '');
    content = escapeHtml(content);

    let replyHtml='';
    if(typeof text==='object' && text.reply){
        let replyContent = escapeHtml(text.reply);
        replyHtml=`<div class='quoted'><i class='fas fa-reply'></i> ${replyContent}</div>`;
    }

    let contentForReplyBtn = content.replace(/'/g,"\\'");
    msgDiv.innerHTML=`${replyHtml}${content}<span class="reply-btn" onclick="setReplyPreview('${contentForReplyBtn}')"><i class="fas fa-reply"></i></span><span class="timestamp">${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>`;

    chatContainer.appendChild(msgDiv);
    chatContainer.scrollTo({top:chatContainer.scrollHeight,behavior:'smooth'});
}

// ===== Status =====
function getCurrentStatus(){
    if(connectionPill.textContent==="Connected") return "connected";
    if(connectionPill.textContent==="Disconnected") return "disconnected";
    return "waiting";
}

// ===== AUDIO CHAT =====
const rtcConfig = { iceServers:[{urls:"stun:stun.l.google.com:19302"}] };

voiceBtn.addEventListener("click", async ()=>{
    if(!hasPaired) return;
    if(!isTalking){
        try{
            localStream=await navigator.mediaDevices.getUserMedia({audio:true});
            startVoiceChat();
            voiceBtn.innerHTML='<i class="fas fa-stop"></i>';
            isTalking=true;
            socket.send(JSON.stringify({type:'speaking',speaking:true}));
        } catch(err){
            console.error("Microphone access denied:",err);
            alert("Microphone permission required to talk.");
        }
    } else {
        stopVoiceChat();
        voiceBtn.innerHTML='<i class="fas fa-microphone"></i>';
        isTalking=false;
        socket.send(JSON.stringify({type:'speaking',speaking:false}));
    }
});

// Mute remote button
muteBtn.addEventListener("click", ()=>{
    if(remoteAudio){
        isRemoteMuted = !remoteAudio.muted;
        remoteAudio.muted = isRemoteMuted;
        socket.send(JSON.stringify({type:'muted',muted:isRemoteMuted}));
        muteBtn.innerHTML=isRemoteMuted?'<i class="fas fa-volume-off"></i>':'<i class="fas fa-volume-mute"></i>';
    }
});

function startVoiceChat(){
    peerConnection=new RTCPeerConnection(rtcConfig);
    localStream?.getTracks().forEach(track=>peerConnection.addTrack(track,localStream));
    peerConnection.ontrack=event=>{
        remoteAudio.srcObject=event.streams[0];
        remoteAudio.play().catch(err=>console.warn("Autoplay prevented:",err));
    };
    peerConnection.onicecandidate=event=>{
        if(event.candidate) socket.send(JSON.stringify({type:"ice",candidate:event.candidate}));
    };
    peerConnection.createOffer()
        .then(offer=>peerConnection.setLocalDescription(offer))
        .then(()=>socket.send(JSON.stringify({type:"offer",sdp:peerConnection.localDescription})));
}

function stopVoiceChat(){
    if(peerConnection) peerConnection.close();
    peerConnection=null;
    if(localStream){
        localStream.getTracks().forEach(track=>track.stop());
        localStream=null;
    }
    remoteAudio.srcObject=null;
}

// ===== Signaling =====
function handleSignaling(data){
    switch(data.type){
        case "offer":
            if(!peerConnection) peerConnection=new RTCPeerConnection(rtcConfig);
            localStream?.getTracks().forEach(track=>peerConnection.addTrack(track,localStream));
            peerConnection.ontrack=event=>{
                remoteAudio.srcObject=event.streams[0];
                remoteAudio.play().catch(err=>console.warn("Autoplay prevented:",err));
            };
            peerConnection.onicecandidate=event=>{
                if(event.candidate) socket.send(JSON.stringify({type:"ice",candidate:event.candidate}));
            };
            peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp))
                .then(()=>peerConnection.createAnswer())
                .then(answer=>peerConnection.setLocalDescription(answer))
                .then(()=>socket.send(JSON.stringify({type:"answer",sdp:peerConnection.localDescription})));
            break;
        case "answer":
            peerConnection?.setRemoteDescription(new RTCSessionDescription(data.sdp));
            break;
        case "ice":
            peerConnection?.addIceCandidate(new RTCIceCandidate(data.candidate));
            break;
    }
}

// ===== Chat controls =====
document.getElementById("endBtn").addEventListener("click",()=>{
    if(socket?.readyState===WebSocket.OPEN) socket.send("__end_chat__");
    manualDisconnect=true; isConnecting=false; hasPaired=false; cleanupSocket();
    chatContainer.innerHTML=''; showTemporaryMessage("Chat ended. Click 🔄 to find a new user.","received");
    setConnectionStatus("disconnected");
});
document.getElementById("newBtn").addEventListener("click",()=>{
    if(socket?.readyState===WebSocket.OPEN && !manualDisconnect) socket.send("__end_chat__");
    manualDisconnect=false; isConnecting=false; hasPaired=false; cleanupSocket();
    chatContainer.innerHTML=''; showTemporaryMessage("Searching for a new user...","received");
    setConnectionStatus("waiting");
    setTimeout(()=>connectChat(),500);
});