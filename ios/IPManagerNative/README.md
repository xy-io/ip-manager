# IPManagerNative (SwiftUI iPad app scaffold)

This folder contains a native SwiftUI scaffold for an iPad-first app that connects to the existing LXC-hosted API (`/api/*`).

## What it includes

- `NavigationSplitView` layout for iPad (sidebar + detail)
- Search/filter UI for IP data
- Editable detail form for a selected IP
- Server settings screen to point at your LXC host (e.g. `http://192.168.0.50`)
- Networking layer compatible with current API:
  - `GET /api/health`
  - `GET /api/ips`
  - `PUT /api/ips`
  - `GET /api/config`

## Add to Xcode

1. Create a new **iOS App** project in Xcode named `IPManagerNative` (SwiftUI lifecycle).
2. Replace the generated Swift files with files under `IPManagerNative/`.
3. Ensure deployment target is iOS 17+ (recommended for best iPad UX).
4. Build and run on iPad simulator/device.
5. In app settings (gear icon), set your LXC base URL.

## Production notes

- Prefer `https://` on LAN if possible.
- If using plain `http://`, configure App Transport Security (ATS) exceptions in your app's `Info.plist`.
- Keep Nginx proxying `/api` to `127.0.0.1:3001` in the LXC.
