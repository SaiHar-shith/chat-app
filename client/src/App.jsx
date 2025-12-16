import { useEffect, useState, useRef } from "react";
import io from "socket.io-client";
import EmojiPicker from "emoji-picker-react";
import Sentiment from "sentiment";
import "./App.css";

const socket = io.connect("https://chat-app-backend-madn.onrender.com");
const sentiment = new Sentiment();

const servers = {
  iceServers: [
    { urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"] },
  ],
};

function App() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [room, setRoom] = useState("");
  const [showChat, setShowChat] = useState(false);
  const [currentMessage, setCurrentMessage] = useState("");
  const [messageList, setMessageList] = useState([]);
  const [typingStatus, setTypingStatus] = useState("");
  const [usersInRoom, setUsersInRoom] = useState([]);
  const [loginError, setLoginError] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  
  const [avatarSeed, setAvatarSeed] = useState("pixel-art"); 
  const [isRobot, setIsRobot] = useState(false); 
  const [customAvatar, setCustomAvatar] = useState(null);
  const [isSpoiler, setIsSpoiler] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const [callActive, setCallActive] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null);
  const [callType, setCallType] = useState(null);
  const [stream, setStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [callDuration, setCallDuration] = useState(0);

  const [showWhiteboard, setShowWhiteboard] = useState(false);
  const [brushColor, setBrushColor] = useState("#000000");
  const isDrawing = useRef(false);
  const canvasRef = useRef(null);
  const prevPos = useRef({ x: 0, y: 0 });

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const avatarInputRef = useRef(null);
  const textAreaRef = useRef(null);
  
  const streamRef = useRef(null); 
  const myVideo = useRef();
  const userVideo = useRef();
  const peerConnection = useRef(null);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins < 10 ? "0" + mins : mins}:${secs < 10 ? "0" + secs : secs}`;
  };

  const getAvatarDisplay = (seed, robotMode, customBase64) => {
    if (customBase64 && customBase64.startsWith("data:image")) return customBase64;
    const style = robotMode ? "bottts" : "avataaars"; 
    return `https://api.dicebear.com/9.x/${style}/svg?seed=${seed}`;
  };

  const randomizeAvatar = () => {
    setCustomAvatar(null);
    const randomString = Math.random().toString(36).substring(7);
    setAvatarSeed(randomString);
  };

  const handleAvatarUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            canvas.width = 100;
            canvas.height = 100; 
            ctx.drawImage(img, 0, 0, 100, 100);
            setCustomAvatar(canvas.toDataURL("image/jpeg", 0.7));
        };
      };
    }
  };

  const joinRoom = async () => {
    setLoginError("");
    if (username !== "" && room !== "" && password !== "") {
      try {
        const finalAvatarData = customAvatar ? customAvatar : (isRobot ? `bottts:${avatarSeed}` : `avataaars:${avatarSeed}`);
        const response = await fetch("https://chat-app-backend-madn.onrender.com/login", {
        method: "POST",
         headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password, avatar_seed: finalAvatarData }),
        });
        const result = await response.json();
        if (result.success) {
          socket.emit("join_room", { room, username });
          if (result.avatar_seed && result.avatar_seed.startsWith("data:image")) {
             setCustomAvatar(result.avatar_seed);
          } else if (result.avatar_seed) {
             if(result.avatar_seed.includes(":")){
                 const [style, seed] = result.avatar_seed.split(":");
                 setAvatarSeed(seed);
                 setIsRobot(style === "bottts");
                 setCustomAvatar(null);
             } else {
                 setAvatarSeed(result.avatar_seed);
             }
          }
          setShowChat(true);
        } else {
          setLoginError(result.message);
        }
      } catch (error) {
        setLoginError("Could not connect to server");
      }
    } else {
      setLoginError("Please fill in all fields");
    }
  };

  const logout = () => { window.location.reload(); };

  const startDrawing = (e) => {
    const { offsetX, offsetY } = getCoordinates(e);
    isDrawing.current = true;
    prevPos.current = { x: offsetX, y: offsetY };
  };

  const draw = (e) => {
    if (!isDrawing.current) return;
    const { offsetX, offsetY } = getCoordinates(e);
    const { x: prevX, y: prevY } = prevPos.current;
    drawOnCanvas(prevX, prevY, offsetX, offsetY, brushColor);
    socket.emit("drawing", { room, x0: prevX, y0: prevY, x1: offsetX, y1: offsetY, color: brushColor });
    prevPos.current = { x: offsetX, y: offsetY };
  };

  const stopDrawing = () => { isDrawing.current = false; };

  const drawOnCanvas = (x0, y0, x1, y1, color) => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = color;
    ctx.lineWidth = color === '#ffffff' ? 15 : 3; 
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.closePath();
  };

  const clearBoard = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    socket.emit("clear", room);
  };

  const getCoordinates = (e) => {
    if (e.touches && e.touches.length > 0) {
        const rect = e.target.getBoundingClientRect();
        return {
            offsetX: e.touches[0].clientX - rect.left,
            offsetY: e.touches[0].clientY - rect.top
        };
    }
    return { offsetX: e.nativeEvent.offsetX, offsetY: e.nativeEvent.offsetY };
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
           const base64Audio = reader.result;
           const avatarToSend = customAvatar ? customAvatar : (isRobot ? `bottts:${avatarSeed}` : `avataaars:${avatarSeed}`);
           const messageData = { room, author: username, message: base64Audio, type: "audio", time: new Date().getHours() + ":" + new Date().getMinutes(), avatar: avatarToSend };
           await socket.emit("send_message", messageData);
           setMessageList((list) => [...list, messageData]);
        };
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) { alert("Could not access microphone."); }
  };
  const stopRecording = () => { if (mediaRecorderRef.current) { mediaRecorderRef.current.stop(); setIsRecording(false); } };

  const sendMessage = async () => {
    if (currentMessage.trim() !== "") {
      const avatarToSend = customAvatar ? customAvatar : (isRobot ? `bottts:${avatarSeed}` : `avataaars:${avatarSeed}`);
      const messageData = { room, author: username, message: currentMessage, type: isSpoiler ? "spoiler" : "text", time: new Date().getHours() + ":" + new Date().getMinutes(), avatar: avatarToSend };
      await socket.emit("send_message", messageData);
      setMessageList((list) => [...list, messageData]);
      setCurrentMessage("");
      setShowPicker(false);
      setIsSpoiler(false);
      if (textAreaRef.current) textAreaRef.current.style.height = "45px";
    }
  };
  const onEmojiClick = (emojiObject) => { setCurrentMessage((prev) => prev + emojiObject.emoji); };
  const selectFile = () => { fileInputRef.current.click(); };
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = async () => {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          canvas.width = 500;
          canvas.height = (img.height * 500) / img.width;
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const compressedBase64 = canvas.toDataURL("image/jpeg", 0.7);
          const avatarToSend = customAvatar ? customAvatar : (isRobot ? `bottts:${avatarSeed}` : `avataaars:${avatarSeed}`);
          const messageData = { room, author: username, message: compressedBase64, type: "image", time: new Date().getHours() + ":" + new Date().getMinutes(), avatar: avatarToSend };
          await socket.emit("send_message", messageData);
          setMessageList((list) => [...list, messageData]);
        };
      };
    }
  };
  const handleInputChange = (e) => {
    setCurrentMessage(e.target.value);
    socket.emit("typing", { room, username });
    const target = e.target;
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
  };
  const handleKeyDown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } };

  const createPeer = () => {
      const peer = new RTCPeerConnection(servers);
      peer.onicecandidate = (event) => {
          if (event.candidate) socket.emit("ice-candidate", { candidate: event.candidate, room: room });
      };
      peer.ontrack = (event) => setRemoteStream(event.streams[0]);
      return peer;
  };

  const startCall = async (type) => {
    if (peerConnection.current) peerConnection.current.close();
    peerConnection.current = createPeer();
    setCallActive(true);
    setCallType(type);
    const constraints = { video: type === 'video', audio: true };
    const localStream = await navigator.mediaDevices.getUserMedia(constraints);
    setStream(localStream);
    streamRef.current = localStream; 
    if(type === 'video' && myVideo.current) myVideo.current.srcObject = localStream;
    localStream.getTracks().forEach((track) => peerConnection.current.addTrack(track, localStream));
    const offer = await peerConnection.current.createOffer({ iceRestart: true });
    await peerConnection.current.setLocalDescription(offer);
    socket.emit("callUser", { room, signalData: offer, from: socket.id, name: username, callType: type });
  };

  const answerCall = async () => {
    setCallActive(true);
    const type = incomingCall.callType;
    setCallType(type);
    if (peerConnection.current) peerConnection.current.close();
    peerConnection.current = createPeer();
    const constraints = { video: type === 'video', audio: true };
    const localStream = await navigator.mediaDevices.getUserMedia(constraints);
    setStream(localStream);
    streamRef.current = localStream;
    if(type === 'video' && myVideo.current) myVideo.current.srcObject = localStream;
    localStream.getTracks().forEach((track) => peerConnection.current.addTrack(track, localStream));
    await peerConnection.current.setRemoteDescription(incomingCall.signal);
    const answer = await peerConnection.current.createAnswer();
    await peerConnection.current.setLocalDescription(answer);
    socket.emit("answerCall", { signal: answer, room });
    setIncomingCall(null);
  };

  const endCall = () => { socket.emit("endCall", { room }); cleanupConnection(); };
  const cleanupConnection = () => {
    setCallActive(false); setIncomingCall(null); setRemoteStream(null); setCallType(null); setCallDuration(0);
    if (streamRef.current) { streamRef.current.getTracks().forEach(track => track.stop()); streamRef.current = null; }
    setStream(null);
    if (peerConnection.current) { peerConnection.current.close(); peerConnection.current = null; }
  };

  useEffect(() => {
    socket.on("receive_message", (data) => setMessageList((list) => [...list, data]));
    socket.on("load_history", (history) => setMessageList(history));
    socket.on("room_users", (users) => setUsersInRoom(users));
    socket.on("display_typing", (user) => { setTypingStatus(`${user} is typing...`); setTimeout(() => setTypingStatus(""), 3000); });
    socket.on("callUser", (data) => { if (!callActive) setIncomingCall({ signal: data.signal, from: data.from, name: data.name, callType: data.callType }); });
    socket.on("callAccepted", (signal) => { if(peerConnection.current) peerConnection.current.setRemoteDescription(signal); });
    socket.on("ice-candidate", (candidate) => { if(peerConnection.current) peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate)); });
    socket.on("callEnded", () => cleanupConnection());
    
    socket.on("drawing", (data) => {
        if(canvasRef.current) drawOnCanvas(data.x0, data.y0, data.x1, data.y1, data.color);
    });
    
    socket.on("clear", () => {
        if(canvasRef.current) {
            const ctx = canvasRef.current.getContext("2d");
            ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
    });

    return () => {
      socket.off("receive_message"); socket.off("load_history"); socket.off("room_users"); socket.off("display_typing");
      socket.off("callUser"); socket.off("callAccepted"); socket.off("ice-candidate"); socket.off("callEnded");
      socket.off("drawing"); socket.off("clear");
    };
  }, [socket, room, callActive]);

  useEffect(() => {
    let timer;
    if (callActive) { timer = setInterval(() => setCallDuration((prev) => prev + 1), 1000); } 
    else { setCallDuration(0); }
    return () => clearInterval(timer);
  }, [callActive]);

  useEffect(() => { if (callType === 'video' && myVideo.current && stream) myVideo.current.srcObject = stream; }, [stream, callActive, callType]);
  useEffect(() => { if (userVideo.current && remoteStream) userVideo.current.srcObject = remoteStream; }, [remoteStream, callActive]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messageList, typingStatus]);

  return (
    <div className="App">
      {!showChat ? (
        <div className="joinChatContainer">
           <h3>Sign in</h3>
           <div className="avatar-customizer" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '20px' }}>
             <img src={getAvatarDisplay(avatarSeed, isRobot, customAvatar)} alt="avatar preview" style={{ width: "80px", height: "80px", borderRadius: "50%", border: "3px solid #000", marginBottom: "10px", objectFit: "cover" }} />
             <div style={{ display: 'flex', gap: '5px' }}>
                <button onClick={randomizeAvatar} className="avatar-btn">🎲 Random</button>
                <button onClick={() => { setIsRobot(!isRobot); setCustomAvatar(null); }} className="avatar-btn">{isRobot ? "🤖 Robot" : "🧑 Human"}</button>
                <button onClick={() => avatarInputRef.current.click()} className="avatar-btn upload-btn">📷 Upload</button>
                <input type="file" style={{display:'none'}} ref={avatarInputRef} onChange={handleAvatarUpload} accept="image/*" />
             </div>
          </div>
          {loginError && <div className="error-banner">⚠️ {loginError}</div>}
          <input type="text" placeholder="Username..." onChange={(e) => setUsername(e.target.value)} />
          <input type="password" placeholder="Password..." onChange={(e) => setPassword(e.target.value)} />
          <input type="text" placeholder="Room ID..." onChange={(e) => setRoom(e.target.value)} onKeyDown={(e) => { e.key === "Enter" && joinRoom(); }}/>
          <button onClick={joinRoom}>Enter Chat</button>
        </div>
      ) : (
        <div className="chat-window">
          {(callActive || incomingCall) && (
              <div className="call-modal">
                 {incomingCall && !callActive && (
                     <div style={{textAlign: "center"}}>
                         <h2>Incoming {incomingCall.callType === 'video' ? 'Video' : 'Voice'} Call from {incomingCall.name}...</h2>
                         <button className="answer-btn" onClick={answerCall}>Answer</button>
                     </div>
                 )}
                 {callActive && (
                    <>
                     {callType === 'video' ? (
                         <div className="video-container">
                             <video playsInline muted ref={myVideo} autoPlay className="my-video" />
                             <video playsInline ref={userVideo} autoPlay className="user-video" />
                             <div style={{ position: 'absolute', bottom: '100px', left: '20px', background: 'rgba(0,0,0,0.5)', padding: '5px 10px', borderRadius: '10px' }}>
                                {formatTime(callDuration)}
                             </div>
                         </div>
                     ) : (
                         <div className="audio-call-view">
                             <video playsInline ref={userVideo} autoPlay style={{display: 'none'}} />
                             <div className="audio-avatar-container">
                                 <div className="pulse-ring"></div>
                                 <img src={getAvatarDisplay(avatarSeed, isRobot, customAvatar)} className="audio-avatar" alt="User" />
                             </div>
                             <h3>Voice Call Connected</h3>
                             <p>{formatTime(callDuration)}</p>
                         </div>
                     )}
                     <div className="call-controls">
                         <button className="end-call-btn" onClick={endCall}>📞</button>
                     </div>
                    </>
                 )}
              </div>
          )}

          {showWhiteboard && (
            <div className="whiteboard-modal">
                <div className="whiteboard-header">
                    <div className="whiteboard-tools">
                        {['#000000', '#FF4444', '#44FF44', '#4444FF'].map(color => (
                            <button key={color} className={`color-picker-btn ${brushColor === color ? 'active' : ''}`} style={{background: color}} onClick={() => setBrushColor(color)} />
                        ))}
                        <button className={`color-picker-btn eraser-btn ${brushColor === '#ffffff' ? 'active' : ''}`} onClick={() => setBrushColor('#ffffff')} title="Eraser">🧽</button>
                        <button className="clear-btn" onClick={clearBoard} title="Clear All">🗑️</button>
                    </div>
                    <button className="close-wb-btn" onClick={() => setShowWhiteboard(false)}>❌</button>
                </div>
                <canvas ref={canvasRef} width={340} height={500} className="whiteboard-canvas" onMouseDown={startDrawing} onMouseUp={stopDrawing} onMouseMove={draw} onTouchStart={startDrawing} onTouchEnd={stopDrawing} onTouchMove={draw} />
            </div>
          )}

          <div className="chat-header">
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0, flex: 1 }}>
                <p style={{marginBottom: "0", lineHeight: "1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>Room: {room}</p>
                <span style={{fontSize: "10px", color: "#ccc"}}>{usersInRoom.length} users online</span>
            </div>
            {/* UPDATED HEADER ACTIONS CONTAINER */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                <button onClick={() => setShowWhiteboard(true)} style={{ background: "transparent", border: "none", fontSize: "20px", cursor: "pointer", padding: "0" }} title="Whiteboard">🎨</button>
                <button onClick={() => startCall('audio')} style={{ background: "transparent", border: "none", fontSize: "20px", cursor: "pointer", padding: "0" }} title="Voice Call">📞</button>
                <button onClick={() => startCall('video')} style={{ background: "transparent", border: "none", fontSize: "20px", cursor: "pointer", padding: "0" }} title="Video Call">📹</button>
                <div className="live-indicator"></div>
                {/* LOGOUT BUTTON */}
                <button className="logout-btn" onClick={logout}>Exit</button>
            </div>
          </div>

          <div className="chat-body">
            {messageList.map((messageContent, index) => {
              const isMe = username === messageContent.author;
              const isSystem = messageContent.author === "SYSTEM";
              let moodClass = "";
              if (!isMe && !isSystem && (messageContent.type === "text" || messageContent.type === "spoiler")) {
                  const result = sentiment.analyze(messageContent.message);
                  if (result.score > 0) moodClass = "mood-positive";
                  if (result.score < 0) moodClass = "mood-negative";
              }
              let avatarSrc = "";
              if (messageContent.avatar && messageContent.avatar.startsWith("data:image")) {
                 avatarSrc = messageContent.avatar;
              } else if (messageContent.avatar && messageContent.avatar.includes(":")) {
                 const [style, seed] = messageContent.avatar.split(':');
                 avatarSrc = `https://api.dicebear.com/9.x/${style}/svg?seed=${seed}`;
              } else {
                 avatarSrc = `https://api.dicebear.com/9.x/avataaars/svg?seed=${messageContent.author}`;
              }

              return (
                <div className={`message-container ${moodClass}`} id={isSystem ? "system" : isMe ? "you" : "other"} key={index}>
                  {!isMe && !isSystem && (
                    <img src={avatarSrc} alt="avatar" style={{ width: "35px", height: "35px", borderRadius: "50%", marginRight: "10px", border: "1px solid #eee", background: "#fff", objectFit: "cover" }} />
                  )}
                  <div style={{ maxWidth: "80%" }}>
                    <div className="message-content" onClick={(e) => { if(messageContent.type === "spoiler") e.currentTarget.querySelector('p').classList.remove("spoiler-hidden"); }}>
                        {messageContent.type === "image" ? (
                            <img src={messageContent.message} alt="shared" style={{ maxWidth: "150px", borderRadius: "10px", display:"block" }} />
                        ) : messageContent.type === "audio" ? (
                            <audio controls src={messageContent.message} style={{ width: "200px", height: "40px" }} />
                        ) : (
                            <p className={messageContent.type === "spoiler" ? "spoiler-hidden" : ""} style={{ margin: 0 }}>
                                {messageContent.message}
                            </p>
                        )}
                    </div>
                    {!isSystem && (
                        <div className="message-meta">
                            <p id="time">{messageContent.time}</p>
                            <p id="author" style={{ fontWeight: "bold" }}>{messageContent.author}</p>
                        </div>
                    )}
                  </div>
                </div>
              );
            })}
            {typingStatus && <div style={{ padding: "10px", fontStyle: "italic", color: "#888", fontSize: "12px", marginLeft: "10px" }}>{typingStatus}</div>}
            <div ref={bottomRef} />
          </div>

          <div className="chat-footer">
             {showPicker && (
               <div style={{ position: "absolute", bottom: "80px", left: "20px", zIndex: 10 }}>
                 <EmojiPicker onEmojiClick={onEmojiClick} width={300} height={400} />
               </div>
             )}
             <div className="input-group">
                <textarea
                    ref={textAreaRef}
                    value={currentMessage}
                    placeholder={isSpoiler ? "Write a secret..." : (isRecording ? "Listening..." : "Message...")}
                    onClick={() => setShowPicker(false)}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    disabled={isRecording}
                />
                <div className="features-container">
                    <input type="file" style={{ display: "none" }} ref={fileInputRef} onChange={handleFileChange} accept="image/*" />
                    <button className="icon-btn" onClick={selectFile} title="Attach">📎</button>
                    <button className="icon-btn" onClick={() => setShowPicker((val) => !val)} title="Emoji">😃</button>
                    <button className={`icon-btn ${isSpoiler ? "active" : ""}`} onClick={() => setIsSpoiler(!isSpoiler)} title="Spoiler">🤫</button>
                    <button className={`icon-btn ${isRecording ? "recording" : ""}`} onMouseDown={startRecording} onMouseUp={stopRecording} onTouchStart={startRecording} onTouchEnd={stopRecording} title="Record">🎙️</button>
                </div>
             </div>
             <button className="send-btn" onClick={sendMessage}>➤</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;