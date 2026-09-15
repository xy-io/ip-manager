# Maintenance & Offline Filter

## Find devices that need attention

From **v2.17.0**, the **Offline** button in the filter bar shows a live count. Click it to narrow the list to non-responding devices. It combines with the type, location, tag and search filters.

Free and Reserved placeholders are excluded. A device with no ping result yet is unknown, not offline. From v2.18.0, maintenance entries are excluded too. When no devices match, the view says **Everything is responding**.

## Mark planned downtime

From **v2.18.0**:

1. Edit the device you are taking down deliberately.
2. Tick **Under maintenance** and save the entry.
3. The device shows an amber maintenance indicator instead of a fault indicator. It leaves the Offline count/filter and stops triggering device-offline notifications.
4. Use the **Maintenance** filter to review flagged entries.
5. When the work is finished, edit the device and clear **Under maintenance**.

The flag never expires automatically. If a flagged device starts responding, the Maintenance button shows an amber count such as **2 up**, reminding you to review it. This is not an automatic end to maintenance.

Maintenance suppresses device-offline notifications; do not assume it mutes unrelated notification types such as service-health or domain-expiry events.

## History, topology and integrations

The actual ping result remains available. Maintenance is a separate state, not a claim that the host is online.

- [Topology](Topology) shows `maintenance` as its own status.
- The [Activity Log](Activity-Log) records when a flag is enabled or cleared.
- The [Home Assistant API](Home-Assistant-API) provides `devices_maintenance` and a per-device `maintenance` boolean. Your own automations must check the flag if you want them to suppress alerts too.
- [API](API) clients can write the boolean field on individual entries and check `capabilities.maintenanceMode`. Strings such as `"false"` are rejected.
