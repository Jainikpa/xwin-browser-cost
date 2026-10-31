# Reads the address bar of the browser window in front through UI Automation without touching the web page, and
# prints what it found as JSON. -Variant picks how far it looks:
#   connect        only opens the window's UI Automation element and reads its name (the floor: any client at all)
#   first-edit     the first Edit control under the window, which is the address bar when the page comes later
#   toolbar-edit   the first ToolBar, then the first Edit inside it
param(
  [ValidateSet('connect', 'first-edit', 'toolbar-edit')]
  [string]$Variant
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Foreground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@

$watch = [Diagnostics.Stopwatch]::StartNew()
$automation = [Windows.Automation.AutomationElement]
$descendants = [Windows.Automation.TreeScope]::Descendants
$root = $automation::FromHandle([Foreground]::GetForegroundWindow())
$result = [ordered]@{ variant = $Variant; title = $root.Current.Name }

if ($Variant -ne 'connect') {
  $container = $root
  if ($Variant -eq 'toolbar-edit') {
    $isToolBar = New-Object Windows.Automation.PropertyCondition($automation::ControlTypeProperty, [Windows.Automation.ControlType]::ToolBar)
    $container = $root.FindFirst($descendants, $isToolBar)
  }
  if ($container) {
    $isEdit = New-Object Windows.Automation.PropertyCondition($automation::ControlTypeProperty, [Windows.Automation.ControlType]::Edit)
    $box = $container.FindFirst($descendants, $isEdit)
    if ($box) {
      $result.boxName = $box.Current.Name
      $result.focused = $box.Current.HasKeyboardFocus
      $pattern = $null
      if ($box.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
        $result.address = $pattern.Current.Value
      }
    }
  }
}

$result.uiaMs = $watch.Elapsed.TotalMilliseconds
$result | ConvertTo-Json -Compress
