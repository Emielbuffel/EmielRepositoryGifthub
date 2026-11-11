// Job watch -> Apple Reminders. Run by sync.sh with:  osascript -l JavaScript add_reminders.js <feed-file>
// Reads the newest list of deadline reminders published by the job watch and adds the missing ones
// to the "Job deadlines" list. Reminders you completed or deleted are not added again.
ObjC.import("Foundation");

function run(argv) {
  var LIST = "Job deadlines";
  var feed = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null);
  var text = feed.isNil() ? "" : feed.js;
  var runs = {};
  text.split("\n").forEach(function (line) {
    if (!line.trim()) return;
    var ev, p;
    try { ev = JSON.parse(line); } catch (e) { return; }
    if (ev.event !== "message" || !ev.message) return;
    try { p = JSON.parse(ev.message); } catch (e) { return; }
    if (p.kind !== "jobwatch-reminders") return;
    (runs[p.run] = runs[p.run] || []).push(p);
  });
  var keys = Object.keys(runs).sort();
  if (!keys.length) return "no reminder data in the last 12 hours";
  var latest = runs[keys[keys.length - 1]];
  var items = [];
  latest.forEach(function (p) { items = items.concat(p.items || []); });

  var seenFile = argv[1];
  var seenRaw = $.NSString.stringWithContentsOfFileEncodingError(seenFile, $.NSUTF8StringEncoding, null);
  var seen = {};
  try { if (!seenRaw.isNil()) seen = JSON.parse(seenRaw.js); } catch (e) { seen = {}; }

  var R = Application("Reminders");
  var lists = R.lists.whose({ name: LIST });
  var list;
  if (lists.length) { list = lists[0]; } else { list = R.List({ name: LIST }); R.lists.push(list); list = R.lists.whose({ name: LIST })[0]; }

  var added = 0;
  items.forEach(function (it) {
    if (seen[it.id]) return;                       // added before (even if you completed or deleted it since)
    var r = R.Reminder({ name: it.name, body: it.body + "\n\njobwatch:" + it.id });
    list.reminders.push(r);
    try { r.dueDate = new Date(it.due); } catch (e) {}
    try { r.remindMeDate = new Date(it.remind); } catch (e) {}
    seen[it.id] = it.remind;
    added++;
  });
  $.NSString.alloc.initWithUTF8String(JSON.stringify(seen)).writeToFileAtomicallyEncodingError(seenFile, true, $.NSUTF8StringEncoding, null);
  return new Date().toISOString() + " added " + added + " of " + items.length + " reminders";
}
