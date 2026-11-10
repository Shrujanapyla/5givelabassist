# 5G Live Lab Assist 2.0 — User Manual

This manual explains how to run a local session as a professor and student. For a full technical setup, use the [Windows local execution guide](WINDOWS_LOCAL_TESTING.md) or [local execution guide](LOCAL_EXECUTION_GUIDE.md). For the experiment procedure and evidence, see the [experiment guide](EXPERIMENT_EXECUTION_GUIDE.md).

## 1. What the app does

The app lets a professor and up to three students join a session. Students can publish a browser camera and microphone stream. The professor can view feeds, draw annotations, and share snapshots of selected regions in a shared workspace. The dashboard also has WebRTC connection statistics and a separate HTTP application-path monitor.

The professor can optionally run AI assistance when an inference service and model are installed. The image benchmark measures the configured MEC inference endpoint only. Cloud comparison, Ethernet IP camera ingest, and 5G radio KPI measurement are not included.

## 2. Before you begin

- Start the backend and frontend. For this workspace, open <http://localhost:5180>; backend health is at <http://localhost:3101/health>.
- Use a current browser. Allow camera and microphone access when prompted. `localhost` is suitable for local camera permissions; a remote server should use HTTPS.
- Create two separate browser profiles for a simple professor/student demo. Use separate physical devices for a realistic multi-device test.
- Have the local professor and student enrollment keys from the project administrator. Demo keys are for local development only.

## 3. Create accounts and sign in

1. In the first browser profile, select **Register device**.
2. Choose the **Professor** role. Enter your email, display name, password, and the professor enrollment key.
3. Sign in with the account you created.
4. In another browser profile, register a second account using the **Student** role and the student enrollment key, then sign in there.
5. Keep account credentials private. Do not share `.env` files or enrollment keys in screenshots or recordings.

Each role has different session controls. The server checks both the account role and session membership before allowing protected actions.

## 4. Start a session

### Professor

1. In the professor profile, select **Create session**.
2. Copy the displayed session code with **Copy session code** and send it to the intended participants through an approved channel.
3. Confirm the participant list shows the joined students. A session supports up to three student camera feeds.

### Student

1. In the student profile, enter the professor's code in **Session code**.
2. Select **Join session**.
3. Confirm that the active session and participants are visible.

The session code grants access to that lab room. Share it only with the participants who should join.

## 5. Share live video

1. As a student, open **Live camera** and select **Enable camera and microphone**.
2. Approve the browser's camera and microphone prompt.
3. Confirm the local preview appears. The professor should see the student's feed after the peer connection is established.
4. Use the available stop controls when finished.

Media travels peer-to-peer between browsers; the backend handles authentication, session state, and WebRTC signaling. If the video does not connect, check permissions, confirm both accounts joined the same session, and retry. Some networks require a TURN relay; this project does not configure one.

## 6. Annotate and share a region

These controls are available to the professor when a student feed is active:

1. Select the student feed if more than one is present.
2. Select **Start drawing**, choose a drawing color if desired, and draw over the video.
3. Select **Stop drawing** to finish or **Clear drawings** to remove the annotations.
4. Select **Capture region**, drag over the area to share, and release.
5. Open **Shared snapshots workspace** to view the ROI snapshot. Add notes or annotations and use the available workspace controls to inspect versions/history.

Snapshots are shared with members of the active session. If selection does nothing, confirm the video is playing and the professor is in the active session.

## 7. Read network status

### Network quality

The **Network quality** panel reports WebRTC peer statistics when the browser exposes them, such as RTT, jitter, packet loss, bitrate, FPS, resolution, and connection state. Some values may be unavailable for a particular browser or connection.

Students can use **Adaptive video** and the **Fallback profile** selector to choose High, Medium, or Low and select **Apply profile**. The browser may reject an unsupported profile. Automatic changes require supported browser controls and sustained network conditions; a stable localhost session may stay at High.

### 5G & Edge monitoring

This panel periodically measures the browser's HTTP path to the application backend. It may show response time, availability, and estimated throughput from bounded transfers. A localhost measurement is only a localhost measurement. The panel does not read radio, slice, or air-interface KPIs and does not prove that traffic used 5G.

## 8. Optional AI object assistance

AI is optional and is not started by the main app launcher. It requires the Python service, dependencies, and an approved local YOLO model file. When it is installed and available, the professor can select **Start AI analysis** while viewing a student's stream. Successful detections may be overlaid on the video, and a suggested region can be captured into the workspace.

The bundled detector integration is generic COCO object detection; it is not trained for lab equipment and is not a safety system. If the AI process or weights are missing, the feature remains unavailable. Do not treat missing output as a successful analysis.

## 9. MEC inference benchmark

The benchmark is professor-only and requires an active session plus a configured, running MEC inference endpoint (`AI_SERVICE_URL` pointing to a service that supports `POST /detect`).

1. Select a PNG, JPEG, or WebP test image no larger than 750 KiB.
2. Choose 3, 5, or 10 samples.
3. Select **Run benchmark** and wait for the results.
4. Review total browser response time, backend-to-endpoint request time, processor-reported inference time, and successful/failed sample counts.
5. Use **Reset results** to clear the current browser-session results/history.

Only the selected sample image is submitted for this benchmark; the lab video is not automatically uploaded. If the MEC inference service is unavailable, the benchmark reports that state and cannot produce valid measurements. Do not interpret blank or failed samples as performance results.

## 10. Sign out and protect the session

Select **Sign out** when finished, especially on a shared computer. The application stores local user/session data on the backend. Do not use real student personal data for an unapproved demo, expose credentials in screen recordings, or share a session code publicly.

## 11. Troubleshooting

| Symptom | What to check |
|---|---|
| Page does not open | Confirm the frontend launcher is running and open the configured Vite address, normally `http://localhost:5180`. |
| “Port is already in use” | A frontend or backend process is probably already running. Stop the existing instance with Ctrl+C in its terminal before restarting; avoid launching duplicates. |
| Backend health fails | Check that the backend is running at the port in `server/.env`; open `/health` at that address. |
| Registration says enrollment key is invalid | Check the role's local key in `server/.env` and use the matching professor or student key. Never use development demo keys in production. |
| Student cannot join | Recheck the full session code, confirm the professor created the session, and verify the participant limit has not been reached. |
| Camera prompt does not appear | Check browser site permissions and OS camera/microphone permissions. Stop other applications using an exclusive camera. |
| Session connects but video does not | Confirm both users joined the same session, check browser permissions and network/firewall restrictions, and retry. Some networks need TURN, which is not configured here. |
| Network values show a dash | The browser may not expose that WebRTC statistic yet, or no active peer connection exists. |
| MEC benchmark is unavailable | Check `AI_SERVICE_URL`, start the inference service, and confirm it serves the expected `POST /detect` API. The AI service is optional and not bundled with the core launcher. |
| AI detections are absent | Confirm the AI service is healthy, dependencies are installed, and model weights are available and load successfully. |

## 12. Scope and validation notes

The app is a small-group peer-to-peer lab collaboration prototype, not an SFU or production remote-lab control system. The repository's automated checks do not replace a live browser, multi-device, college MEC, or real 5G acceptance test. See [feature verification](FEATURE_VERIFICATION.md) for tested and untested areas.
