# Debugging Guide for Video Call Issues

## How to Diagnose Video Problems

### 1. Check Browser Console

```javascript
// Open DevTools → Console tab and watch for errors:
// - "[PeerLink] call error:" indicates media negotiation failure
// - "NotAllowedError" = permission denied
// - "NotFoundError" = no camera/mic device
// - "NotReadableError" = device already in use
```

### 2. Inspect Stream Quality

```javascript
// In browser console, check what the peer received:
const stream = usePeerStore.getState().remoteStream;
console.log("Remote video tracks:", stream.getVideoTracks().length);
console.log("Remote audio tracks:", stream.getAudioTracks().length);
```

### 3. Check UI State

The new state flags help identify the issue:

```javascript
// In browser console:
const state = usePeerStore.getState();
console.log("Status:", state.status); // Should be "connected"
console.log("Has local video:", state.hasLocalVideo);
console.log("Has remote video:", state.hasRemoteVideo);
console.log("Local stream:", !!state.localStream);
console.log("Remote stream:", !!state.remoteStream);
```

### Common Issues and Solutions

#### Issue: "Waiting for remote video..." persists indefinitely

**Diagnosis:**

```
status = "calling" (not "connected")
remoteStream = null
```

**Solutions:**

1. Check ICE connection → open DevTools Network tab, look for STUN/TURN failures
2. Increase `CALL_TIMEOUT_MS` (currently 60s) if network is slow
3. Check if both peers can reach public STUN servers (google.com, openrelay.metered.ca)

#### Issue: Black video with "connected" status

**Diagnosis:**

```
status = "connected" ✓
remoteStream exists ✓
hasRemoteVideo = false ✗
```

**Solution:**
This is now handled properly → should show audio-only UI instead. If it shows blank:

1. Check if remote peer actually has a camera
2. Verify camera permission was granted on remote peer's device
3. Check if camera is already in use by another application

#### Issue: Chat not working but video works

**Diagnosis:**

```
mediaCall established ✓
dataConnection = null ✗
status = "connected"
```

**Solutions:**

1. Check `wireDataConnection()` in PeerContainer.tsx → may need to debug "open" event
2. Verify `peer.connect()` is being called properly in startCall()
3. Check if PeerServer connection is stable (sometimes peer connection drops)

#### Issue: One-way video (can see them, they can't see you)

**Likely causes:**

1. Asymmetric NAT configuration → enable TURN servers
2. Firewall blocking outbound media → check corporate network settings
3. Browser permissions inconsistent → clear and re-grant permissions

**Debug:**

```javascript
// Check both sides of the call:
const localStream = usePeerStore.getState().localStream;
console.log("Local sending:", localStream?.getVideoTracks()[0]?.enabled);

const remoteStream = usePeerStore.getState().remoteStream;
console.log("Remote can receive:", remoteStream?.getVideoTracks().length > 0);
```

### 3. Enable PeerJS Debug Mode

PeerContainer.tsx initializes PeerJS with `debug: 1`. This adds console output. For more verbose logging:

```javascript
// In PeerContainer.tsx, change initialization:
const peerInstance = new PeerJS(undefined as unknown as string, {
  debug: 3,  // 0=none, 1=errors, 2=warnings, 3=all
  config: { iceServers: ICE_SERVERS, iceTransportPolicy: "all" },
});
```

---

## Testing Scenarios

### Scenario 1: Audio-Only → Video Fallback (FIXED)

1. Start call with one peer's camera disabled
2. UI should show audio-only interface, not blank video ✓

### Scenario 2: Permission Denied → Graceful Fallback (FIXED)

1. One peer denies camera but allows microphone
2. Call establishes with audio ✓
3. `hasLocalVideo` should be `false` ✓
4. Control bar hides camera button ✓

### Scenario 3: Add/Remove Video Track Mid-Call (Known Limitation)

Currently unsupported - would need RTC renegotiation. User must end and restart call.

### Scenario 4: Detecting Remote Video Availability

The new `hasRemoteVideo` flag makes this reliable:

```javascript
// Watch for remote video change:
usePeerStore.subscribe(
  (state) => state.hasRemoteVideo,
  (hasVideo) =>
    console.log("Remote video:", hasVideo ? "available" : "unavailable"),
);
```

---

## Performance Considerations

### Stream Constraints

Current constraints from `getBestStream()`:

```javascript
video: { width: { ideal: 1280 }, height: { ideal: 720 } }
```

- These are **ideal** not required → will downgrade on constraint failure
- 720p @ ~500kbps typical for WebRTC
- Lower on poor connections

### Memory

- Each MediaStream holds track references
- Properly calling `getTracks().forEach(t => t.stop())` is critical
- The reset() function handles this

### Network

- TURN server fallback is essential for corporate/NAT scenarios
- Current servers: OpenRelay (free, rate-limited) + Google STUN
- Consider adding a dedicated TURN server for production

---

## Future Improvements

1. **Implement track renegotiation**: Allow enabling/disabling video without ending call
2. **Add bandwidth adaptation**: Detect poor connection and downgrade constraints
3. **ICE candidate monoitoring**: Log when ICE fails or succeeds
4. **Statistics panel**: Show bitrate, packet loss, latency for debugging
5. **Connection analytics**: Log which ICE candidates are used (direct, STUN, TURN)

---

## Production Readiness Checklist

- [ ] Replace OpenRelay (free, rate-limited) with dedicated TURN server
- [ ] Add error tracking/analytics (e.g., Sentry)
- [ ] Implement retry logic for failed calls
- [ ] Add connection quality indicator to UI
- [ ] Test on multiple browsers (Chrome, Firefox, Safari, Edge)
- [ ] Test on mobile (iOS Safari restricted RTCDataChannel)
- [ ] Load test with multiple concurrent calls
- [ ] Monitor TURN server usage and costs
