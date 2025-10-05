let originalTitle = document.title;
const chatContainer = document.getElementById("chatContainer");
const msgInput = document.getElementById("msg");
const typingStatus = document.getElementById("typingStatus");
const chatHeader = document.getElementById("chatHeader");
const inputBar = document.getElementById("inputBar");
const appContainer = document.getElementById("appContainer");
const connectionPill = document.getElementById("connectionPill");
const replyPreview = document.getElementById("replyPreview");
const callBtn = document.getElementById("callBtn");
const speakerBtn = document.getElementById("speakerBtn");
document.getElementById("sendBtn").addEventListener("click", () => sendMsg());
msgInput.addEventListener("keydown", (e) => {
    if(e.key === "Enter" && !e.shiftKey) { // prevents shift+Enter from sending
        e.preventDefault();
        sendMsg();
    }
});

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

let isInCall = false;
let callStartTime = null;
let callTimerInterval = null;

const statusDots = { connected:'🟢', waiting:'⚪', disconnected:'🔴' };

// ===== UTILITY FUNCTIONS =====
function updateTitle(status, lastMessage = "") {
    let dot = statusDots[status] || '⚪';
    let newMsg = unreadMessage && lastMessage
        ? `💬 New: ${lastMessage.slice(0, 20)}... `
        : (unreadMessage ? "💬 New message " : "");
    document.title = `${dot} ${newMsg}${originalTitle}`;
}

function showTemporaryMessage(text, type){
    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${type}`;
    msgDiv.textContent = text;
    chatContainer.appendChild(msgDiv);
    chatContainer.scrollTo({top: chatContainer.scrollHeight, behavior: "smooth"});
    setTimeout(()=>{ if(msgDiv.parentNode) msgDiv.parentNode.removeChild(msgDiv); }, 2000);
}

function setReplyPreview(content) {
    replyToMessage = content;
    replyPreview.innerHTML = `<span>Replying to: ${content}</span><i class="fas fa-times" title="Cancel"></i>`;
    replyPreview.style.display = "flex";

    // Automatically focus the input box
    msgInput.focus();

    // Cancel reply handler
    replyPreview.querySelector("i").addEventListener("click", () => {
        replyToMessage = null;
        replyPreview.style.display = "none";
        msgInput.focus(); // focus back to input
    });
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

// ===== CHAT CONNECT =====
function connectChat() {
    if(isConnecting) return;
    isConnecting=true;
    cleanupSocket();
    hasPaired=false;

    socket = new WebSocket("wss://php-chat-ws-1.onrender.com");

    const connectTimer = setTimeout(() => {
        if(!socket || socket.readyState!==WebSocket.OPEN){
            // console.warn("WebSocket timed out, retrying...");
            try { socket.close(); } catch{}
            isConnecting=false;
            setConnectionStatus("waiting");
            showTemporaryMessage("Reconnecting...", "received");
            connectChat();
        }
    }, 10000);

    socket.onopen = ()=>{
        clearTimeout(connectTimer);
        manualDisconnect=false;
        isConnecting=false;
        fetch("../helpers/get-ip.php").then(res=>res.text()).then(clientIp=>{
            const initPayload = {event:"init", ip: clientIp, userAgent: navigator.userAgent};
            if(navigator.geolocation){
                navigator.geolocation.getCurrentPosition(
                    pos => { initPayload.geo = {lat: pos.coords.latitude, lon: pos.coords.longitude}; safeSend(initPayload); },
                    () => safeSend(initPayload)
                );
            } else safeSend(initPayload);
        });
    };

    socket.onmessage = async e => {
        // 1. Typing indicator
        if (e.data === "__typing__") {
            typingStatus.textContent = "Typing...";
            typingStatus.style.display = "block";
            if (typingTimeout) clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                typingStatus.style.display = "none";
                typingStatus.textContent = "";
            }, 1500);
            return;
        }
    
        // 2. Partner ended chat
        if (e.data === "__partner_ended__") {
            setConnectionStatus("waiting");
            showTemporaryMessage("Partner ended the chat. Searching for a new user...", "received");
            cleanupSocket();
            isConnecting = false;
            hasPaired = false;
            setTimeout(() => connectChat(), 1000);
            return;
        }
    
        // 3. Paired event
        if (e.data === "__paired__") {
            setConnectionStatus("connected");
            hasPaired = true;
            showTemporaryMessage("You are now paired with a stranger!", "received");
            return;
        }
    
        // 4. Parse JSON for chat & call events
        let jsonData;
        try {
            jsonData = JSON.parse(e.data);
        } catch {
            jsonData = null;
        }
    
        if (jsonData) {
            switch (jsonData.type) {
                case "muted":
                    showRemoteMute(jsonData.muted);
                    break;
                case "call_hangup":
                    showTemporaryMessage("❌ Call ended by the other user", "received");
                    stopVoiceChat();
                    break;
                case "call_accept":
                    createCallOverlay("inCall");
                    updateCallOverlay("📞 In Call", true); 
                    startCall();
                    await switchAudioOutput(false);
                    startCallTimer();
                    break;
                case "call_request":
                    createCallOverlay("incoming");
                    await switchAudioOutput(false);
                    break;
                case "call_reject":
                    removeCallOverlay();
                    showTemporaryMessage("❌ Call rejected", "received");
                    callBtn.disabled = false;
                    break;
                case "offer":
                case "answer":
                case "ice":
                    handleSignaling(jsonData);
                    break;
            }
        }
    
        // 5. Chat messages
        if (hasPaired && jsonData?.text) {
            addMessage(jsonData, "received");
            unreadMessage = true;
            updateTitle(getCurrentStatus(), jsonData.text);
            
            if (document.hidden || !document.hasFocus()) {
                showNotification("New message", jsonData.text);
            }
            
        } else if (hasPaired && typeof e.data === "string" && !jsonData) {
            addMessage(e.data, "received");
            unreadMessage = true;
            updateTitle(getCurrentStatus(), e.data);
        }
    };

    socket.onclose=()=>{
        clearTimeout(connectTimer);
        if(!manualDisconnect){
            showTemporaryMessage("Disconnected ❌ Searching for a new user...", "received");
            setConnectionStatus("waiting");
            setTimeout(()=>{ reconnectInterval=Math.min(reconnectInterval*2,10000); isConnecting=false; connectChat();}, reconnectInterval);
        } else setConnectionStatus("disconnected");
    };
    socket.onerror = err=>{ console.error("WebSocket error", err); clearTimeout(connectTimer); socket.close(); };
}


// ===== CHAT SEND =====
function sendMsg(){
    const msg = msgInput.value.trim();
    if(!msg || !socket || socket.readyState!==WebSocket.OPEN || !hasPaired) return;
    const payload={ text: msg };
    if(replyToMessage){ payload.reply=replyToMessage; replyToMessage=null; replyPreview.style.display='none'; }
    safeSend(payload);
    addMessage(payload,"sent");
    msgInput.value='';
}

function addMessage(text,type){
    const msgDiv=document.createElement("div");
    msgDiv.className=`message ${type}`;
    let content = typeof text==="object"? (text.text||''):(text||'');
    content = content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    let replyHtml = "";
    if(typeof text==='object' && text.reply){
        let replyContent=text.reply.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        replyHtml=`<div class='quoted'><i class='fas fa-reply'></i> ${replyContent}</div>`;
    }
    let contentForReplyBtn = content.replace(/'/g,"\\'");
    msgDiv.innerHTML=`${replyHtml}${content}<span class="reply-btn" onclick="setReplyPreview('${contentForReplyBtn}')"><i class="fas fa-reply"></i></span><span class="timestamp">${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>`;
    chatContainer.appendChild(msgDiv);
    chatContainer.scrollTo({top:chatContainer.scrollHeight, behavior:'smooth'});
}
async function getLocalStream() {
    try {
        return await navigator.mediaDevices.getUserMedia({ audio: true }); // audio-only
    } catch (err) {
        console.warn("Media permission denied:", err);
        throw err;
    }
}
let isMuted = false;
// ===== CALL UI =====
function createCallOverlay(type="outgoing"){
    removeCallOverlay();
    appContainer.style.display = "none";
    isInCall = type === "inCall" || type === "outgoing" || type === "incoming";
    

    let overlay = document.createElement("div");
    overlay.id="callOverlay";
    overlay.style.cssText = `
        position: fixed; top:0; left:0; width:100%; height:100%;
        display:flex; flex-direction:column; justify-content:center; align-items:center;
        background: rgba(0,0,0,0.9); color:#0ff; font-family: 'Segoe UI'; gap:20px; z-index:9999;
    `;
    
    let titleText = type==="outgoing" ? "📞 Calling..." 
        : type==="incoming" ? "📞 Stranger is calling" 
        : "📞 In Call";
    
    let buttonsHTML="";
    if(type==="incoming") {
        buttonsHTML = `
            <button id="acceptCall"><i class="fas fa-phone"></i></button>
            <button id="rejectCall"><i class="fas fa-phone-slash"></i></button>
        `;
    } else {
        buttonsHTML = `
            <button id="hangupBtn"><i class="fas fa-phone-slash"></i></button>
            <button id="speakerBtn"><i class="fas fa-volume-up"></i></button>
            <button id="muteBtn"><i class="fas fa-microphone"></i></button>
            <button id="videoBtn"><i class="fas fa-video"></i></button>
        `;
    }
    
    let durationHTML = type==="inCall"? `<span id="callDuration">00:00</span>` : "";
    
    overlay.innerHTML = `
        <div class="call-title" style="font-size:1.5rem;">${titleText}</div>
        ${durationHTML ? `<span id="callDuration">${durationHTML}</span>` : ""}
       <div class="buttons" style="display: flex;gap: 15px;z-index: 1000;justify-content: center;position: absolute;bottom: 30px;left: 50%;transform: translateX(-50%);
       ">${buttonsHTML}</div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelectorAll("button").forEach(btn=>{
        btn.style.padding="10px 20px"; btn.style.fontSize="1rem"; btn.style.border="none";
        btn.style.borderRadius="12px"; btn.style.cursor="pointer"; btn.style.color="#fff"; btn.style.transition="0.2s";
        if(btn.id==="hangupBtn" || btn.id==="rejectCall") btn.style.background="#ff4b5c";
        if(btn.id==="muteBtn" || btn.id==="acceptCall") btn.style.background="#1dd1a1";
        btn.onmouseover=()=>btn.style.transform="scale(1.05)";
        btn.onmouseout=()=>btn.style.transform="scale(1)";
    });

    // ----- Button Events -----
    if(type==="incoming"){
        document.getElementById("acceptCall").onclick = () => {
            safeSend({ type:"call_accept" });
            startCall();
            createCallOverlay("inCall");
            updateCallOverlay("📞 In Call", true); 
            startCallTimer();
        };
        document.getElementById("rejectCall").onclick = () => {
            safeSend({ type:"call_reject" });
            removeCallOverlay();
        };

    } else if(type==="outgoing" || type==="inCall") {
        
        document.getElementById("hangupBtn").onclick = () => {
            if(socket && socket.readyState === WebSocket.OPEN) safeSend({ type:"call_hangup" });
            stopVoiceChat();
        };
        
        
       document.getElementById("muteBtn").onclick = () => {
           if (!peerConnection || !localStream) {
               showTemporaryMessage("⚠️ No local stream to mute", "received");
               return;
           }
       
           // Toggle mute state
           isMuted = !isMuted;
       
           // Mute/unmute all local audio tracks
           localStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
       
           // Mute/unmute all audio senders in the peer connection
           peerConnection.getSenders().forEach(sender => {
               if (sender.track && sender.track.kind === "audio") {
                   sender.track.enabled = !isMuted;
               }
           });
       
           // Update button UI
           const btn = document.getElementById("muteBtn");
           btn.style.background = isMuted ? "#c3676c" : "#1dd1a1";
           btn.innerHTML = isMuted
               ? "<i class='fas fa-microphone-slash'></i>"
               : "<i class='fas fa-microphone'></i>";
       
           showTemporaryMessage(isMuted ? "🔇 Microphone Muted" : "🎤 Microphone On", "received");
       
           // Optional: notify remote peer
           if (socket && socket.readyState === WebSocket.OPEN) {
               safeSend({ type: "muted", muted: isMuted });
           }
       };



        const videoBtn = document.getElementById("videoBtn");
        if(videoBtn) videoBtn.onclick = () => toggleVideo();
    }
}

// ===== REMOVE CALL OVERLAY =====
function removeCallOverlay(){
    const overlay=document.getElementById("callOverlay");
    if(overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    appContainer.style.display="flex";
    stopCallTimer();
    isInCall=false;
    callBtn.disabled=false;

    const localVideo=document.getElementById("localVideo");
    if(localVideo) localVideo.remove();
    const remoteVideo=document.getElementById("remoteVideo");
    if(remoteVideo) remoteVideo.remove();
}
function updateCallOverlay(title, showButtons=true) {
    let overlay = document.getElementById("callOverlay");
    if(!overlay) return;
    const titleEl = overlay.querySelector(".call-title");
    if(titleEl) titleEl.textContent = title;
    overlay.querySelector(".buttons")?.classList.toggle("hidden", !showButtons);
}
// ===== REMOTE MUTE ICON -----
function showRemoteMute(muted){
    let icon = document.getElementById("remoteMuteIcon");
    if(!icon){
        icon = document.createElement("div");
        icon.id="remoteMuteIcon";
        icon.textContent = "🔇";
        icon.style.position="absolute";
        icon.style.top="10px";
        icon.style.right="10px";
        icon.style.fontSize="2rem";
        icon.style.color="red";
        icon.style.zIndex = 10001;
        document.body.appendChild(icon);
    }
    icon.style.display = muted ? "block" : "none";
}

// ===== AUDIO CHAT =====
const rtcConfig = { iceServers:[{urls:"stun:stun.l.google.com:19302"}] };


function startCall() {
    if (peerConnection) return;
    peerConnection = new RTCPeerConnection(rtcConfig);

    getLocalStream().then(stream => {
        localStream = stream;
        addTracksToPeerConnection(peerConnection, localStream);

        // no createLocalVideo() here – wait for toggleVideo() to be clicked

        peerConnection.ontrack = event => {
            const remoteStream = event.streams[0];
        
            if (remoteStream.getVideoTracks().length > 0) {
                const remoteVideoEl = createRemoteVideo();
                // Only assign if not already assigned
                if (remoteVideoEl.srcObject !== remoteStream) {
                    remoteVideoEl.srcObject = remoteStream;
                }
        
                // Force loudspeaker if available
                if (typeof remoteAudio.setSinkId === "function") {
                    navigator.mediaDevices.enumerateDevices().then(devices => {
                        const speaker = devices.find(d => d.kind === "audiooutput" && /speaker|default/i.test(d.label));
                        if (speaker) remoteAudio.setSinkId(speaker.deviceId).catch(console.warn);
                    });
                }
            } else {
                // Audio-only fallback
                if (typeof remoteAudio.setSinkId === "function") {
                    navigator.mediaDevices.enumerateDevices().then(devices => {
                        const earpiece = devices.find(d => d.kind === "audiooutput" && /earpiece/i.test(d.label));
                        if (earpiece) remoteAudio.setSinkId(earpiece.deviceId).catch(console.warn);
                    });
                }
                remoteAudio.srcObject = remoteStream;
            }
        };

        peerConnection.onicecandidate = event => {
            if (event.candidate) safeSend({ type:"ice", candidate:event.candidate });
        };

        peerConnection.createOffer()
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => safeSend({ type:"offer", sdp: peerConnection.localDescription }));
    }).catch(err => {
        console.error("Audio init failed:", err);
        showTemporaryMessage("⚠️ Cannot access microphone.", "received");
    });
}

function stopVoiceChat(){
    // Close peer connection
    if(peerConnection){
        peerConnection.getSenders().forEach(sender => {
            // Stop all tracks being sent
            if(sender.track) sender.track.stop();
        });
        peerConnection.close();
        peerConnection = null;
    }

    // Stop all local tracks just in case
    if(localStream){
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    // Remove audio/video elements
    if(remoteAudio) remoteAudio.srcObject = null;
    const localVideo = document.getElementById("localVideo");
    if(localVideo) localVideo.remove();
    const remoteVideo = document.getElementById("remoteVideo");
    if(remoteVideo) remoteVideo.remove();

    // Reset UI
    removeCallOverlay();
    isInCall = false;
    callBtn.disabled = false;
    isMuted = false;
    isUsingSpeaker = false;
    // Hide remote mute icon
    const remoteMuteIcon = document.getElementById("remoteMuteIcon");
    if(remoteMuteIcon) remoteMuteIcon.style.display = "none";
}


// ===== SIGNALING =====
let pendingCandidates = [];

function handleSignaling(data){
    switch(data.type){
        case "offer":
            if (!peerConnection) peerConnection = new RTCPeerConnection(rtcConfig);

            getLocalStream().then(stream => {
                localStream = stream;
                addTracksToPeerConnection(peerConnection, localStream);

                // Show local preview if video available
                if (localStream.getVideoTracks().length) {
                    createLocalVideo().srcObject = localStream;
                }

                peerConnection.ontrack = event => {
                    const hasVideo = event.streams[0].getVideoTracks().length > 0;
                    if (hasVideo) {
                        const remoteVideoEl = createRemoteVideo();
                        remoteVideoEl.srcObject = event.streams[0];
                    } else {
                        remoteAudio.srcObject = event.streams[0];
                    }
                };

                peerConnection.onicecandidate = event => {
                    if (event.candidate) safeSend({ type:"ice", candidate:event.candidate });
                };

                // Set remote description and create answer
                peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp))
                    .then(() => {
                        // Add any buffered ICE candidates
                        pendingCandidates.forEach(c => peerConnection.addIceCandidate(new RTCIceCandidate(c)));
                        pendingCandidates = [];
                        return peerConnection.createAnswer();
                    })
                    .then(answer => peerConnection.setLocalDescription(answer))
                    .then(() => safeSend({ type: "answer", sdp: peerConnection.localDescription }));
            }).catch(err => {
                console.error("Failed to get local media for answering call:", err);
                // fallback: answer without local media
                peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp))
                    .then(() => peerConnection.createAnswer())
                    .then(answer => peerConnection.setLocalDescription(answer))
                    .then(() => safeSend({ type: "answer", sdp: peerConnection.localDescription }));
            });
            break;

        case "answer":
            if(peerConnection && peerConnection.signalingState === "have-local-offer") {
                peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp)).catch(console.error);
            } else {
                console.warn("Received answer in wrong signaling state:", peerConnection?.signalingState);
            }
            break;

        case "ice":
            if(peerConnection?.remoteDescription) {
                peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(console.error);
            } else {
                // buffer ICE candidates until remote description is set
                pendingCandidates.push(data.candidate);
            }
            break;
    }
}

// ===== Notification =====
async function showNotification(title, body) {
    if (Notification.permission === "default") {
        await Notification.requestPermission();
    }

    if (Notification.permission === "granted" && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ title, body });
    }
}

// Helper: convert VAPID key
function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, "+")
        .replace(/_/g, "/");

    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}
async function renegotiate() {
    if (!peerConnection) return;
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    safeSend({ type: "offer", sdp: peerConnection.localDescription });
}
async function addVideoTrack(stream) {
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
        peerConnection.addTrack(videoTrack, stream);
        await renegotiate(); // send new offer
    }
}
let isUsingSpeaker = false; // keep track of current mode

async function switchAudioOutput(useSpeaker) {
    if (!remoteAudio) return;
    isUsingSpeaker = !!useSpeaker;

    // Modern browsers (Chrome, Edge, some Android WebViews)
    if (typeof remoteAudio.setSinkId === "function") {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const outputs = devices.filter(d => d.kind === "audiooutput");

            // try to find device with keywords
            const findDevice = (keywords) => 
                outputs.find(d => keywords.some(k => (d.label || "").toLowerCase().includes(k)));

            let target = useSpeaker
                ? findDevice(["speaker", "speakerphone", "hands", "default"])
                : findDevice(["earpiece", "receiver", "handset", "phone"]);

            // fallback: pick default if nothing found
            if (!target && outputs.length) {
                target = outputs.find(d => /default|speaker/i.test(d.label)) || outputs[0];
            }

            if (target) {
                await remoteAudio.setSinkId(target.deviceId);
                showTemporaryMessage(useSpeaker ? "🔊 Speaker On" : "🎧 Earpiece Mode", "received");
                console.log("Audio output switched to:", target.label || target.deviceId);
            } else {
                console.warn("No matching audio output found. Using default.");
            }
        } catch (err) {
            console.warn("switchAudioOutput failed:", err);
        }
    } else {
        // Safari / iOS fallback
        // Lower volume to simulate earpiece (since Safari doesn’t allow sink switching)
        remoteAudio.volume = useSpeaker ? 1 : 0.4;
        showTemporaryMessage(useSpeaker ? "🔊 Speaker Mode" : "🎧 Earpiece Mode (simulated)", "received");
    }

    // Update speaker button icon if exists
    const speakerBtn = document.getElementById("speakerBtn");
    if (speakerBtn) {
        speakerBtn.innerHTML = useSpeaker
            ? "<i class='fas fa-volume-up'></i>"
            : "<i class='fas fa-volume-off'></i>";
    }
}

async function ensureCameraPermission() {
    try {
        const permission = await navigator.permissions.query({ name: "camera" });
        if (permission.state === "denied") {
            showTemporaryMessage("⚠️ Camera access denied. Please allow camera in browser settings.", "received");
            return false;
        }
        return true;
    } catch {
        // fallback for browsers that don’t support navigator.permissions
        return true;
    }
}

// Call at call start

// ===== CALL TIMER =====
function startCallTimer(){ callStartTime=Date.now(); callTimerInterval=setInterval(()=>{ const el=document.getElementById("callDuration"); if(!el) return; let diff=Date.now()-callStartTime; let mins=Math.floor(diff/60000); let secs=Math.floor((diff%60000)/1000); el.textContent=`${mins.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')}`; },1000);}
function stopCallTimer(){ clearInterval(callTimerInterval); callTimerInterval=null; }

// ===== CHAT CONTROLS =====
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
    connectChat();
});


document.getElementById("callBtn").addEventListener("click", async () => {
    if(!hasPaired || isInCall) return; // prevents calling if not paired or already in call
    const allowed = await ensureCameraPermission();
    if (!allowed) return; // stop call if camera is denied
    safeSend({ type: "call_request" });
    createCallOverlay("outgoing");
    isInCall = true; // mark call state immediately
});
let remoteVideo = null;
function makeDraggable(videoEl) {
    let isDragging = false;
    let offsetX = 0, offsetY = 0;

    // Mouse events
    videoEl.addEventListener('mousedown', e => {
        isDragging = true;
        offsetX = e.clientX - videoEl.offsetLeft;
        offsetY = e.clientY - videoEl.offsetTop;
        videoEl.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', e => {
        if (!isDragging) return;
        videoEl.style.left = `${e.clientX - offsetX}px`;
        videoEl.style.top = `${e.clientY - offsetY}px`;
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            videoEl.style.cursor = 'grab';
        }
    });

    // Touch events for mobile
    videoEl.addEventListener('touchstart', e => {
        isDragging = true;
        const touch = e.touches[0];
        offsetX = touch.clientX - videoEl.offsetLeft;
        offsetY = touch.clientY - videoEl.offsetTop;
    });

    document.addEventListener('touchmove', e => {
        if (!isDragging) return;
        const touch = e.touches[0];
        videoEl.style.left = `${touch.clientX - offsetX}px`;
        videoEl.style.top = `${touch.clientY - offsetY}px`;
    }, { passive: false });

    document.addEventListener('touchend', () => {
        isDragging = false;
    });

    videoEl.style.cursor = 'grab'; // show grab cursor initially
}
function createLocalVideo() {
    if(document.getElementById("localVideo")) return document.getElementById("localVideo");

    const video = document.createElement("video");
    video.id = "localVideo";
    video.autoplay = true;
    video.muted = true;           // Safari requires muted for autoplay
    video.playsInline = true;     // prevent fullscreen autoplay on iOS
    video.setAttribute("muted", "");   // force Safari to recognize muted
    video.setAttribute("playsinline", ""); // double enforce playsInline

    video.style.position = "absolute";
    video.style.bottom = "120px";
    video.style.right = "10px";
    video.style.width = "120px";
    video.style.height = "160px";
    video.style.borderRadius = "12px";
    video.style.objectFit = "cover";
    video.style.zIndex = 9999;

    document.body.appendChild(video);
    makeDraggable(video);

    return video;
}


function createRemoteVideo() {
    if (remoteVideo) return remoteVideo;

    remoteVideo = document.createElement("video");
    remoteVideo.id = "remoteVideo";
    remoteVideo.autoplay = true;
    remoteVideo.playsInline = true;
    remoteVideo.style.position = "absolute";
    remoteVideo.style.top = 0;
    remoteVideo.style.left = 0;
    remoteVideo.style.width = "100%";
    remoteVideo.style.height = "100%";
    remoteVideo.style.objectFit = "contain";
    remoteVideo.style.zIndex = 1;

    const overlay = document.getElementById("callOverlay");
    if (overlay) {
        // Ensure overlay is positioned
        if (getComputedStyle(overlay).position === "static") {
            overlay.style.position = "relative";
        }
        overlay.insertBefore(remoteVideo, overlay.firstChild); // behind buttons
    } else {
        document.body.appendChild(remoteVideo);
    }

    return remoteVideo;
}
async function toggleVideo() {
    if (!peerConnection || !localStream) return;

    let videoTrack = localStream.getVideoTracks()[0];

    // Case 1: No video track yet → request camera
    if (!videoTrack) {
        try {
            const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const newVideoTrack = videoStream.getVideoTracks()[0];

            localStream.addTrack(newVideoTrack);
            peerConnection.addTrack(newVideoTrack, localStream);

            // Ensure all audio tracks respect mute state
            localStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
            peerConnection.getSenders().forEach(sender => {
                if (sender.track && sender.track.kind === "audio") sender.track.enabled = !isMuted;
            });

            createLocalVideo().srcObject = localStream;
            showTemporaryMessage("🎥 Video On", "received");

            // Switch to loudspeaker automatically for video calls
            await switchAudioOutput(true);

            // Renegotiate only after confirming stream ready
            if (peerConnection && peerConnection.signalingState !== "closed") {
                await renegotiate();
            }

        } catch (err) {
            console.error("Video permission denied:", err);
            showTemporaryMessage("⚠️ Cannot access camera.", "received");
        }
    } 
    // Case 2: Already have video → toggle enable/disable
    else {
        videoTrack.enabled = !videoTrack.enabled;

        // Ensure audio respects mute state
        localStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
        peerConnection.getSenders().forEach(sender => {
            if (sender.track && sender.track.kind === "audio") sender.track.enabled = !isMuted;
        });

        showTemporaryMessage(videoTrack.enabled ? "🎥 Video On" : "📴 Video Off", "received");
        if (videoTrack.enabled) {
            await switchAudioOutput(true);  // video on → loudspeaker
        } else {
            await switchAudioOutput(false); // video off → back to earpiece
        }

        // Switch audio route depending on state
        if (typeof remoteAudio.setSinkId === "function") {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const targetDevice = videoTrack.enabled
                ? devices.find(d => d.kind === "audiooutput" && /speaker|default/i.test(d.label))
                : devices.find(d => d.kind === "audiooutput" && /earpiece/i.test(d.label));

            if (targetDevice) await remoteAudio.setSinkId(targetDevice.deviceId).catch(console.warn);
        }

        // If re-enabled, renegotiate so remote gets it again
        if (videoTrack.enabled && !peerConnection.signalingState.includes("closed")) {
            await renegotiate();
        }
    }
}

function addTracksToPeerConnection(pc, stream) {
    stream.getTracks().forEach(track => {
        // Don't add duplicates
        const existingSender = pc.getSenders().find(s => s.track === track);
        if (!existingSender) {
            pc.addTrack(track, stream);
        }

        // Apply current mute state
        if (track.kind === "audio") {
            track.enabled = !isMuted;
        }
    });
}

function getCurrentStatus() {
    if (connectionPill.textContent === "Connected") return "connected";
    if (connectionPill.textContent === "Disconnected") return "disconnected";
    return "waiting";
}
if (speakerBtn) {
    speakerBtn.onclick = async () => {
        await switchAudioOutput(!isUsingSpeaker);
    };
}
// ===== FIRST-TIME USER WARNING =====
function showLegalWarning() {
    if (!localStorage.getItem('legalWarningSeen')) {
        const modal = document.getElementById('legalWarningModal');
        modal.style.display = 'flex'; 
    }else{
        connectChat();
    }
}

document.getElementById('acceptWarning').onclick = () => {
    localStorage.setItem('legalWarningSeen', 'true');
    document.getElementById('legalWarningModal').style.display = 'none';
};

// Run after page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showLegalWarning);
} else {
    showLegalWarning();
}