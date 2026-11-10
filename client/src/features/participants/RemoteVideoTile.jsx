import { useEffect, useRef, useState } from 'react';

export default function RemoteVideoTile({ stream, connection, name, selected, onClick }) {
  const videoRef = useRef(null);
  const [connectionState, setConnectionState] = useState(connection?.connectionState || 'new');
  const [cameraState, setCameraState] = useState('Waiting for camera');

  useEffect(() => {
    if (videoRef.current && videoRef.current.srcObject !== stream) videoRef.current.srcObject = stream || null;
  }, [stream]);

  useEffect(() => {
    if (!connection) {
      setConnectionState('unavailable');
      return undefined;
    }
    const update = () => setConnectionState(connection.connectionState || 'unknown');
    connection.addEventListener?.('connectionstatechange', update);
    update();
    return () => connection.removeEventListener?.('connectionstatechange', update);
  }, [connection]);

  useEffect(() => {
    const track = stream?.getVideoTracks?.()[0];
    if (!track) {
      setCameraState('No video stream');
      return undefined;
    }
    const update = () => {
      if (track.readyState === 'ended') setCameraState('Camera stopped');
      else if (track.muted) setCameraState('Camera temporarily muted');
      else setCameraState('Camera live');
    };
    track.addEventListener('mute', update);
    track.addEventListener('unmute', update);
    track.addEventListener('ended', update);
    update();
    return () => {
      track.removeEventListener('mute', update);
      track.removeEventListener('unmute', update);
      track.removeEventListener('ended', update);
    };
  }, [stream]);

  return (
    <button type="button" className={`participant-tile${selected ? ' selected' : ''}`} onClick={onClick} aria-pressed={selected}>
      <video ref={videoRef} autoPlay playsInline muted />
      <span className="participant-tile-name">{name}{selected ? ' · Selected' : ''}</span>
      <span className="participant-tile-status">{cameraState} · {connectionState}</span>
    </button>
  );
}
