// Reads the address bar of a browser window for the tracker (Windows), through UI Automation. It looks only inside the
// browser's own toolbar, never at the web page: reading the page makes Chrome and Edge switch on accessibility for
// every tab, which about doubles their CPU. browser-address.ts starts it once and sends one line per request:
//   in:   "<request id> <window handle>"
//   out:  "<request id>\t<1 while the person is typing in the address bar, else 0>\t<address bar text>"
// Built by scripts/build-address-bar-reader.js with the C# 5 compiler that ships with .NET Framework 4, so it keeps to
// C# 5.
using System;
using System.IO;
using System.Text;
using System.Windows.Automation;

static class AddressBarReader
{
    static readonly Condition IsToolBar =
        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ToolBar);
    static readonly Condition IsEdit =
        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit);
    const string Unread = "0\t";

    static void Main()
    {
        var encoding = new UTF8Encoding(false);
        var input = new StreamReader(Console.OpenStandardInput(), encoding);
        var output = new StreamWriter(Console.OpenStandardOutput(), encoding);
        output.AutoFlush = true;

        string request;
        while ((request = input.ReadLine()) != null)
        {
            string[] parts = request.Split(' ');
            long handle;
            if (parts.Length != 2 || !long.TryParse(parts[1], out handle)) continue;
            output.WriteLine(parts[0] + "\t" + AddressBar(new IntPtr(handle)));
        }
    }

    static string AddressBar(IntPtr window)
    {
        try
        {
            AutomationElement root = AutomationElement.FromHandle(window);
            AutomationElement toolBar = root.FindFirst(TreeScope.Descendants, IsToolBar);
            AutomationElement box = toolBar == null ? null : toolBar.FindFirst(TreeScope.Descendants, IsEdit);
            object pattern;
            if (box == null || !box.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) return Unread;

            string typing = box.Current.HasKeyboardFocus ? "1" : "0";
            return typing + "\t" + OneLine(((ValuePattern)pattern).Current.Value);
        }
        catch (Exception)
        {
            // The window closed, or the browser did not answer: this request gets no address, the next one tries again.
            return Unread;
        }
    }

    static string OneLine(string text)
    {
        return text.Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' ');
    }
}
