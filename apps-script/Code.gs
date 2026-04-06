/**
 * Wedding sheet web app — paste this entire file into your Apps Script project
 * (Extensions → Apps Script). Deploy → Manage deployments → New version.
 *
 * Tabs: RSVP, Guest List (invite list), Seating Plan (seating — created on first save if missing)
 */
var SPREADSHEET_ID = '1yd5fSZ917vOsspjXJBbNwaR9QzUyX4uumcUiPJ5SjEk';
var RSVP_TAB = 'RSVP';
var SEATING_TAB = 'Seating Plan';
var GUEST_LIST = 'Guest List';

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    var action = e.parameter.action || 'submitRSVP';
    if (action === 'getGuests') {
      return getGuestData();
    }
    if (action === 'getGuestsRSVPYes') {
      return getGuestsRSVPYes();
    }
    if (action === 'getSeatingPlan') {
      return getSeatingPlan();
    }
    if (action === 'saveSeatingPlan') {
      var payload = e.parameter.payload || e.parameter.data;
      if (!payload) {
        return jsonResponse_({ success: false, error: 'Missing payload' });
      }
      return saveSeatingPlan(JSON.parse(payload));
    }
    if (action === 'submitRSVP') {
      return submitRSVP(e.parameter);
    }
    return jsonResponse_({ error: 'Invalid action' });
  } catch (err) {
    return jsonResponse_({ error: String(err) });
  }
}

function doPost(e) {
  try {
    if (e.postData && e.postData.contents) {
      try {
        var data = JSON.parse(e.postData.contents);
        if (data.action === 'saveSeatingPlan') {
          return saveSeatingPlan(data);
        }
      } catch (parseErr) {
        /* not JSON — fall through to doGet */
      }
    }
    return doGet(e);
  } catch (err) {
    return jsonResponse_({ error: String(err) });
  }
}

/** Invite list: Guest List tab + submitted family IDs from RSVP tab */
function getGuestData() {
  try {
    var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    var guestSheet = spreadsheet.getSheetByName(GUEST_LIST);
    if (!guestSheet) {
      return jsonResponse_({
        error: 'Tab not found: ' + GUEST_LIST + ' (create it or fix the GUEST_LIST name in the script)'
      });
    }
    var data = guestSheet.getDataRange().getValues();
    var guests = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (row[0]) {
        guests.push({ fullName: row[0], familyId: row[1] });
      }
    }
    var submittedFamilies = [];
    var rsvpSheet = spreadsheet.getSheetByName(RSVP_TAB);
    if (rsvpSheet) {
      var rsvpData = rsvpSheet.getDataRange().getValues();
      if (rsvpData.length > 0) {
        var headers = rsvpData[0].map(function (h) {
          return String(h).trim();
        });
        var familyIdCol = headers.indexOf('Family ID');
        if (familyIdCol !== -1) {
          for (var j = 1; j < rsvpData.length; j++) {
            var fid = rsvpData[j][familyIdCol];
            if (fid && String(fid).trim() && submittedFamilies.indexOf(String(fid).trim()) === -1) {
              submittedFamilies.push(String(fid).trim());
            }
          }
        }
      }
    }
    return jsonResponse_({ guests: guests, submittedFamilies: submittedFamilies });
  } catch (err) {
    return jsonResponse_({ error: String(err) });
  }
}

function headerIndex_(headers, name) {
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === name) return i;
  }
  return -1;
}

/** All guests on RSVP tab with Attending = yes */
function getGuestsRSVPYes() {
  try {
    var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = spreadsheet.getSheetByName(RSVP_TAB);
    if (!sheet) {
      return jsonResponse_({ guests: [], error: 'Tab not found: ' + RSVP_TAB });
    }
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      return jsonResponse_({ guests: [] });
    }
    var headers = data[0].map(function (h) {
      return String(h).trim();
    });
    var col = {
      name: headerIndex_(headers, 'Guest Name'),
      attending: headerIndex_(headers, 'Attending'),
      email: headerIndex_(headers, 'Email'),
      meal: headerIndex_(headers, 'Meal'),
      dietary: headerIndex_(headers, 'Dietary Restrictions'),
      song: headerIndex_(headers, 'Song Request'),
      familyId: headerIndex_(headers, 'Family ID')
    };
    if (col.name === -1 || col.attending === -1) {
      return jsonResponse_({
        guests: [],
        error: 'RSVP tab must include Guest Name and Attending columns'
      });
    }
    var guests = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var att = row[col.attending];
      if (String(att).trim().toLowerCase() !== 'yes') continue;
      var g = { fullName: String(row[col.name] || '').trim() };
      if (!g.fullName) continue;
      if (col.email !== -1 && row[col.email]) g.email = String(row[col.email]).trim();
      if (col.meal !== -1 && row[col.meal]) g.meal = String(row[col.meal]).trim();
      if (col.dietary !== -1 && row[col.dietary]) g.dietary = String(row[col.dietary]).trim();
      if (col.song !== -1 && row[col.song]) g.song = String(row[col.song]).trim();
      if (col.familyId !== -1 && row[col.familyId]) g.familyId = String(row[col.familyId]).trim();
      guests.push(g);
    }
    return jsonResponse_({ guests: guests });
  } catch (err) {
    return jsonResponse_({ error: String(err) });
  }
}

function getOrCreateSeatingSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SEATING_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(SEATING_TAB);
    sheet.getRange(1, 1, 1, 3).setValues([['tableNumber', 'seatNumber', 'guestName']]);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
    sheet.getRange(1, 1, 1, 3).setBackground('#f0f0f0');
  }
  return sheet;
}

function getSeatingPlan() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SEATING_TAB);
    if (!sheet) {
      return jsonResponse_({ version: 1, tables: {} });
    }
    var data = sheet.getDataRange().getValues();
    var tables = {};
    for (var i = 1; i < data.length; i++) {
      var t = data[i][0];
      var s = data[i][1];
      var name = data[i][2];
      if (t === '' || t === null || t === undefined) continue;
      var ts = String(Math.floor(Number(t)));
      if (!tables[ts]) tables[ts] = {};
      tables[ts][String(Math.floor(Number(s)))] = name ? String(name) : '';
    }
    return jsonResponse_({ version: 1, tables: tables });
  } catch (err) {
    return jsonResponse_({ error: String(err) });
  }
}

/**
 * Body or GET payload: { assignments: [ { table, seat, guestName }, ... ] }
 * or { tables: { "1": { "1": "Name", ... } } }
 */
function saveSeatingPlan(data) {
  try {
    var sheet = getOrCreateSeatingSheet_();
    var assignments = [];
    if (data.assignments && data.assignments.length) {
      data.assignments.forEach(function (a) {
        assignments.push({
          table: Math.floor(Number(a.table)),
          seat: Math.floor(Number(a.seat)),
          guestName: a.guestName != null ? String(a.guestName) : ''
        });
      });
    } else if (data.tables) {
      Object.keys(data.tables).forEach(function (t) {
        var inner = data.tables[t];
        Object.keys(inner).forEach(function (s) {
          assignments.push({
            table: Math.floor(Number(t)),
            seat: Math.floor(Number(s)),
            guestName: inner[s] != null ? String(inner[s]) : ''
          });
        });
      });
    }
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow, 3).clearContent();
    }
    if (assignments.length === 0) {
      return jsonResponse_({ success: true, saved: 0 });
    }
    var rows = assignments.map(function (a) {
      return [a.table, a.seat, a.guestName];
    });
    // getRange(row, column, numRows, numColumns) — numRows must match rows.length
    sheet.getRange(2, 1, rows.length, 3).setValues(rows);
    return jsonResponse_({ success: true, saved: rows.length });
  } catch (err) {
    return jsonResponse_({ success: false, error: String(err) });
  }
}

function submitRSVP(formData) {
  try {
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(RSVP_TAB);
    if (!sheet) {
      sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getActiveSheet();
    }
    var guestNames = formData['guest-names'] || '';
    var email = formData.email || '';
    var familyId = formData['family_id'] || '';
    var individualResponses = [];
    var idx;
    for (idx = 0; idx < 10; idx++) {
      var attending = formData['attending_' + idx];
      var meal = formData['meal_' + idx];
      if (attending || meal) {
        var guestName = formData['guest_name_' + idx] || 'Guest ' + (idx + 1);
        var dietary = formData['dietary_' + idx] || '';
        var song = formData['song_' + idx] || '';
        individualResponses.push({
          name: guestName,
          attending: attending || '',
          meal: meal || '',
          dietary: dietary,
          song: song
        });
      }
    }
    if (individualResponses.length === 0 && guestNames) {
      var names = guestNames.split(' & ');
      names.forEach(function (name, index) {
        var att = formData['attending_' + index] || '';
        var ml = formData['meal_' + index] || '';
        if (att || ml) {
          individualResponses.push({
            name: name.trim(),
            attending: att,
            meal: ml,
            dietary: formData['dietary_' + index] || '',
            song: formData['song_' + index] || ''
          });
        }
      });
    }
    var timestamp = new Date();
    individualResponses.forEach(function (guest) {
      var rowData = [timestamp, guest.name, email, guest.attending, guest.meal, guest.dietary, guest.song, familyId];
      sheet.appendRow(rowData);
    });
    return jsonResponse_({ success: true, guests: individualResponses.length });
  } catch (err) {
    return jsonResponse_({ success: false, error: String(err) });
  }
}
