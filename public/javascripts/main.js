var ws, pc, localStream, initiator = 1, wsReady = false, started = false,
    getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia,
    URL = window.URL || window.webkitURL || window.msURL || window.oURL,
    PeerConnection = window.PeerConnection || window.mozRTCPeerConnection || window.webkitPeerConnection00 || window.webkitRTCPeerConnection,
    SessionDescription = window.mozRTCSessionDescription || window.RTCSessionDescription,
    IceCandidate = window.mozRTCIceCandidate || window.RTCIceCandidate,
    MediaStream = window.MediaStream || window.webkitMediaStream;

var StunIceServer = {
  iceServers: [{
    url: "stun:stun.l.google.com:19302"
  }]
};


$(function() {
  getUserMedia = getUserMedia.bind(navigator);
  getUserMedia({ video: true, audio: true }, gotStream, noStream);

  $('#offerButton').click(function() {
    doCall();
  });
});

function gotStream(stream) {
  localVideo = document.getElementById('localVideo');
  remoteVideo = document.getElementById('remoteVideo');  
  localVideo.src = URL.createObjectURL(stream);
  localStream = stream;

  // Connect WebSocket Server
  ws = new WebSocket('ws://localhost:3000');
  ws.onopen = wsOnOpen;
  ws.onmessage = wsOnMessage;

  stream.onended = noStream;
}

function noStream(err) {
  console.log("No stream: " + err);
}

function maybeStart() {
  if (!started && localStream && wsReady) {
    // Connect STUN/ICE Server
    try {
      var pc_constraints = { optional: [{ RtpDataChannels: true }]};
      pc = new PeerConnection(StunIceServer, pc_constraints);
      console.log(pc);

      pc.onopen = pcOnOpen;
      pc.onicecandidate = pcOnIceCandidate;

      console.log("Created RTCPeerConnnection with:\n" +
                  "  config: \"" + JSON.stringify(StunIceServer) + "\";\n" +
                  "  constraints: \"" + JSON.stringify(pc_constraints) + "\".");

      pc.onaddstream = pcOnAddStream;
      pc.onremovestream = pcOnRemoveStream;

      pc.addStream(localStream);
      started = true;
      //if (initiator) {
      //  doCall();
      //}
    } catch(e) {
      console.log("Failed to create PeerConnection, exception: " + e.message);
      alert("Cannot create RTCPeerConnection object; WebRTC is not supported by this browser.");
      return;
    }
  }
}

function pcOnOpen() {
  console.log("[DEBUG] -- Call pcOnOpen");
}

function pcOnIceCandidate(e) {
  console.log("[DEBUG] -- Call pcOnIceCandidate");

  if (e.candidate) {
    console.log(e.candidate);
    // websocket send message
    wsSendMessage({
      type: 'candidate',
      label: e.candidate.sdpMLineIndex,
      id: e.candidate.sdpMid,
      candidate: e.candidate.candidate
    });
  } else {
    console.log("End of candidates.");
  }
}

function pcOnAddStream(e) {
  console.log("[DEBUG] -- Call pcOnAddStream");
  remoteVideo.src = URL.createObjectURL(e.stream);
}

function pcOnRemoveStream(e) {
  console.log("[DEBUG] -- Call pcOnRemoveStream");
}

// connect ws server

function wsOnOpen() {
  console.log("[DEBUG] -- Call wsOnOpen");

  wsReady = true;
  if (initiator) maybeStart();
}

function wsOnMessage(e) {
  console.log("[DEBUG] -- Call wsOnMessage");

  processSignalingMessage(e);
}

function wsSendMessage(mess) {
  var msgString = JSON.stringify(mess);
  console.log("[DEBUG] -- C->S: " + msgString);

  ws.send(msgString); 
}

function processSignalingMessage(e) {
  console.log('[DEBUG] -- Call proccessSignalingMessage()');

  try {
    var msg = JSON.parse(e.data);
    console.log(msg.type);

    if (msg.type === 'offer') {
      if (!initiator && !started) {
        maybeStart();
      }
      pc.setRemoteDescription(new SessionDescription(msg));
      doAnswer();
    } else if (msg.type === 'answer') {
      pc.setRemoteDescription(new SessionDescription(msg));
    } else if (msg.type === 'candidate') {
      var candidate = new IceCandidate({
        sdpMLineIndex: msg.label,
        candidate: msg.candidate
      });
      pc.addIceCandidate(candidate);
    } else if (msg.type === 'bye') {
      onRemoteHungUp();
    }
  } catch (e) {
    throw e;
    console.log('Invalid message', e.data);
  }
}

function doCall() {
  console.log("[DEBUG] -- Call doCall()");

  pc.createOffer(function(session_description) {
    console.log(session_description);
    session_description.sdp = preferOpus(session_description.sdp);
    pc.setLocalDescription(session_description);
    wsSendMessage(session_description);
  });
}

function doAnswer() {
  console.log("[DEBUG] -- Call doAnswer()");

  pc.createAnswer(function(session_description) {
    console.log(session_description);
    pc.setLocalDescription(session_description);
    wsSendMessage(session_description);
  });
}

function setLocalAndSendMessage(sessionDescription) {
  // Set Opus as the preferred codec in SDP if Opus is present.
  sessionDescription.sdp = preferOpus(sessionDescription.sdp);
  pc.setLocalDescription(sessionDescription);
  sendMessage(sessionDescription);
}

function mergeConstraints(cons1, cons2) {
  var merged = cons1;
  for (var name in cons2.mandatory) {
    merged.mandatory[name] = cons2.mandatory[name];
  }
  merged.optional.concat(cons2.optional);
  return merged;
}

// Set Opus as the default audio codec if it's present.
function preferOpus(sdp) {
  var sdpLines = sdp.split('\r\n');

  // Search for m line.
  for (var i = 0; i < sdpLines.length; i++) {
    if (sdpLines[i].search('m=audio') !== -1) {
      var mLineIndex = i;
      break;
    } 
  }
  if (mLineIndex === null)
    return sdp;

  // If Opus is available, set it as the default in m line.
  for (var i = 0; i < sdpLines.length; i++) {
    if (sdpLines[i].search('opus/48000') !== -1) {        
      var opusPayload = extractSdp(sdpLines[i], /:(\d+) opus\/48000/i);
      if (opusPayload)
        sdpLines[mLineIndex] = setDefaultCodec(sdpLines[mLineIndex], opusPayload);
      break;
    }
  }

  // Remove CN in m line and sdp.
  sdpLines = removeCN(sdpLines, mLineIndex);

  sdp = sdpLines.join('\r\n');
  return sdp;
}

function extractSdp(sdpLine, pattern) {
  var result = sdpLine.match(pattern);
  return (result && result.length == 2) ? result[1] : null;
}

function removeCN(sdpLines, mLineIndex) {
  var mLineElements = sdpLines[mLineIndex].split(' ');
  // Scan from end for the convenience of removing an item.
  for (var i = sdpLines.length - 1; i >= 0; i--) {
    var payload = extractSdp(sdpLines[i], /a=rtpmap:(\d+) CN\/\d+/i);
    if (payload) {
      var cnPos = mLineElements.indexOf(payload);
      if (cnPos !== -1) {
        // Remove CN payload from m line.
        mLineElements.splice(cnPos, 1);
      }
      // Remove CN line in sdp
      sdpLines.splice(i, 1);
    }
  }

  sdpLines[mLineIndex] = mLineElements.join(' ');
  return sdpLines;
}

function setDefaultCodec(mLine, payload) {
  var elements = mLine.split(' ');
  var newLine = [];
  var index = 0;
  for (var i = 0; i < elements.length; i++) {
    if (index === 3) // Format of media starts from the fourth.
    newLine[index++] = payload; // Put target payload to the first.
    if (elements[i] !== payload) newLine[index++] = elements[i];
  }
  return newLine.join(' ');
}

function onRemoteHangup() {
  console.log('[DEBUG] -- Call onRemoteHangup() Session terminated.');
  started = false;
  pc.close();
  pc = null;
  initiator = 0;
}
