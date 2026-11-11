#!/bin/bash
# Job watch: remove the Apple Reminders helper from this Mac (your reminders stay).
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.jobwatch.reminders.plist" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/com.jobwatch.reminders.plist"
rm -rf "$HOME/Library/Application Support/JobWatch"
echo "Removed."
