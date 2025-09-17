# WiFi Disable Auto Suspend

## Problem
External USB WiFi adapter (Realtek 0bda:c811) was automatically turning off when not connected to any network for a while, causing connectivity issues.

## Device Identification
- **USB Device**: Bus 001 Device 002: ID 0bda:c811 Realtek Semiconductor Corp. 802.11ac NIC
- **USB Path**: /sys/bus/usb/devices/1-3
- **Driver**: rtw_8821cu
- **Interface**: wlx001325221ed9
- **MAC Address**: 00:13:25:22:1e:d9

## Current Status Before Fix
- USB Power Control: `on` (autosuspend disabled)
- USB Autosuspend Delay: `-1000` (disabled)
- Wireless Power Management: `on` (enabled - this was the issue)

## Solutions Implemented

### 1. Driver-Level Power Management Disable
Created `/etc/modprobe.d/rtw_8821cu.conf`:
```
options rtw_8821cu rtw_power_mgnt=0 rtw_enusbss=0
```
- `rtw_power_mgnt=0`: Disables wireless power management
- `rtw_enusbss=0`: Disables USB selective suspend

### 2. Udev Rule for Interface Power Management
Created `/etc/udev/rules.d/99-disable-wifi-pm.rules`:
```
ACTION=="add", SUBSYSTEM=="net", ATTR{address}=="00:13:25:22:1e:d9", RUN+="/sbin/iwconfig %k power off"
```
- Automatically disables power management when the WiFi interface is added
- Targets the specific device by MAC address

### 3. Reload Udev Rules
Executed `sudo udevadm control --reload-rules` to apply the new udev rule.

## How to Apply Changes
1. **Immediate (recommended)**: Unplug and replug the USB WiFi adapter
2. **Alternative**: Reboot the system
3. **Manual override**: `sudo iwconfig wlx001325221ed9 power off`

## Verification
Check the power management status:
```bash
iwconfig wlx001325221ed9
```
Should show: `Power Management:off`

## Scope
- **Device-specific**: Configurations target this specific Realtek USB WiFi adapter
- **Port-independent**: Works regardless of which USB port the adapter is plugged into
- **Driver-wide**: Modprobe options apply to all rtw_8821cu devices

## Notes
- USB autosuspend was already disabled at the bus level
- The issue was specifically with wireless interface power management
- Changes persist across reboots and device reconnections</content>
<parameter name="filePath">/home/wfr-daq/daq-radio/Wifi Disable Auto Suspend.md