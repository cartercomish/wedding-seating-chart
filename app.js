(function () {
  'use strict';

  var NUM_TABLES = 15;
  var SEATS_PER_TABLE = 8;
  /** Clockwise from top-left: 1–4 along the top edge, then 8–5 along the bottom (right to left). */
  var SEAT_LAYOUT = [
    [1, 2, 3, 4],
    [8, 7, 6, 5]
  ];

  /** Tables with a light yellow panel (end tables in each row of five). */
  var YELLOW_FILL_TABLES = { 4: true, 5: true, 9: true, 10: true, 14: true, 15: true };

  var BRIDE_GROOM_NAMES = {
    'carter comish': true,
    'sarah wildeman': true
  };

  function isBrideOrGroom(fullName) {
    return !!BRIDE_GROOM_NAMES[String(fullName || '').trim().toLowerCase()];
  }

  var cfg = window.SEATING_CHART_CONFIG;
  if (!cfg || !cfg.scriptUrl) {
    console.error('Set scriptUrl in config.js.');
  }

  var state = {
    /** tableNum -> { seatNum -> guestName string } */
    assignments: {},
    /** guest fullName -> true for quick lookup */
    allYesGuests: []
  };

  var MOBILE_PICKER_MAX_PX = 768;

  function isMobilePickerMode() {
    return window.matchMedia(
      '(max-width: ' + MOBILE_PICKER_MAX_PX + 'px)'
    ).matches;
  }

  function $(sel) {
    return document.querySelector(sel);
  }

  function setStatus(msg, isError) {
    var el = $('#status');
    el.textContent = msg || '';
    el.classList.toggle('error', !!isError);
  }

  function scriptUrl(action, extraParams) {
    if (!cfg || !cfg.scriptUrl) {
      throw new Error('Set scriptUrl in config.js');
    }
    var u = new URL(cfg.scriptUrl);
    u.searchParams.set('action', action);
    if (extraParams) {
      Object.keys(extraParams).forEach(function (k) {
        u.searchParams.set(k, extraParams[k]);
      });
    }
    return u.toString();
  }

  function savePayloadString() {
    return JSON.stringify({ tables: buildTablesPayload().tables });
  }

  function fetchJson(url) {
    return fetch(url).then(function (r) {
      return r.json();
    });
  }

  function emptyAssignments() {
    var a = {};
    for (var t = 1; t <= NUM_TABLES; t++) {
      a[t] = {};
      for (var s = 1; s <= SEATS_PER_TABLE; s++) {
        a[t][s] = '';
      }
    }
    return a;
  }

  function mergePlanIntoAssignments(tables) {
    var a = emptyAssignments();
    if (!tables) return a;
    Object.keys(tables).forEach(function (tk) {
      var t = parseInt(tk, 10);
      if (t < 1 || t > NUM_TABLES) return;
      var row = tables[tk];
      Object.keys(row).forEach(function (sk) {
        var s = parseInt(sk, 10);
        if (s < 1 || s > SEATS_PER_TABLE) return;
        a[t][s] = row[sk] ? String(row[sk]).trim() : '';
      });
    });
    return a;
  }

  function collectAssignedNames(assignments) {
    var set = {};
    Object.keys(assignments).forEach(function (t) {
      Object.keys(assignments[t]).forEach(function (s) {
        var n = assignments[t][s];
        if (n) set[n.toLowerCase()] = n;
      });
    });
    return set;
  }

  function loadData() {
    setStatus('Loading…');
    var uYes = scriptUrl('getGuestsRSVPYes');
    var uPlan = scriptUrl('getSeatingPlan');
    return Promise.all([fetchJson(uYes), fetchJson(uPlan)])
      .then(function (results) {
        var yesData = results[0];
        var planData = results[1];
        if (yesData.error) throw new Error(yesData.error);
        if (planData.error) throw new Error(planData.error);
        state.allYesGuests = yesData.guests || [];
        state.assignments = mergePlanIntoAssignments(planData.tables);
        setStatus('Loaded.');
        renderAll();
      })
      .catch(function (err) {
        console.error(err);
        setStatus(String(err.message || err), true);
      });
  }

  function buildTablesPayload() {
    var tables = {};
    for (var t = 1; t <= NUM_TABLES; t++) {
      tables[String(t)] = {};
      for (var s = 1; s <= SEATS_PER_TABLE; s++) {
        var name = state.assignments[t][s] || '';
        if (name) tables[String(t)][String(s)] = name;
      }
    }
    return { version: 1, tables: tables };
  }

  function savePlan() {
    if (!cfg || !cfg.scriptUrl) {
      setStatus('Set scriptUrl in config.js', true);
      return;
    }
    var body = {
      action: 'saveSeatingPlan',
      tables: buildTablesPayload().tables
    };
    var payload = JSON.stringify(body);
    setStatus('Saving…');

    function finishOk(data) {
      if (data.error) throw new Error(data.error);
      if (data.success === false) throw new Error(data.error || 'Save failed');
      setStatus('Saved (' + (data.saved != null ? data.saved + ' seats' : 'ok') + ').');
    }

    fetch(cfg.scriptUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: payload
    })
      .then(function (r) {
        return r.json();
      })
      .then(finishOk)
      .catch(function () {
        var u = new URL(cfg.scriptUrl);
        u.searchParams.set('action', 'saveSeatingPlan');
        u.searchParams.set('payload', savePayloadString());
        return fetch(u.toString(), { method: 'GET', redirect: 'follow' })
          .then(function (r) {
            return r.json();
          })
          .then(function (data) {
            finishOk(data);
          })
          .catch(function (err2) {
            setStatus('Save failed: ' + (err2.message || err2), true);
          });
      });
  }

  function clearGuestFromAssignments(exceptTable, exceptSeat, guestName) {
    if (!guestName) return;
    var target = guestName.trim().toLowerCase();
    for (var t = 1; t <= NUM_TABLES; t++) {
      for (var s = 1; s <= SEATS_PER_TABLE; s++) {
        if (t === exceptTable && s === exceptSeat) continue;
        var v = state.assignments[t][s];
        if (v && v.trim().toLowerCase() === target) {
          state.assignments[t][s] = '';
        }
      }
    }
  }

  /** First + last word initials; single word → first two letters. Saved data stays full name. */
  function initialsFromFullName(fullName) {
    var s = String(fullName || '').trim();
    if (!s) return '?';
    var parts = s.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      var a = parts[0].charAt(0);
      var b = parts[parts.length - 1].charAt(0);
      return (a + b).toUpperCase();
    }
    if (parts[0].length >= 2) {
      return parts[0].substring(0, 2).toUpperCase();
    }
    return parts[0].charAt(0).toUpperCase();
  }

  /**
   * @param {string} name - full name (always stored; written to sheet on save)
   * @param {string} source
   * @param {{ compact?: boolean }} [options] - compact: show initials in seat, full name on hover
   */
  function createChip(name, source, options) {
    options = options || {};
    var span = document.createElement('span');
    span.className = 'guest-chip';
    if (isBrideOrGroom(name)) {
      span.classList.add('guest-chip--shimmer');
    }
    if (options.compact) {
      span.classList.add('guest-chip--compact');
      span.textContent = initialsFromFullName(name);
      span.title = name;
      span.setAttribute('aria-label', name);
    } else {
      span.textContent = name;
    }
    span.draggable = true;
    span.dataset.guestName = name;
    span.dataset.source = source || '';
    span.addEventListener('selectstart', function (e) {
      e.preventDefault();
    });
    span.addEventListener('mousedown', function (e) {
      if (e.button === 0) {
        var sel = window.getSelection && window.getSelection();
        if (sel && sel.rangeCount) sel.removeAllRanges();
      }
    });
    span.addEventListener('dragstart', onDragStart);
    span.addEventListener('dragend', onDragEnd);
    return span;
  }

  var dragInfo = {
    name: '',
    source: '',
    sourceTable: null,
    sourceSeat: null
  };

  function onDragStart(ev) {
    var el = ev.target;
    dragInfo.name = el.dataset.guestName || '';
    dragInfo.source = el.dataset.source || '';
    if (
      el.dataset.table !== undefined &&
      el.dataset.table !== '' &&
      el.dataset.seat !== undefined &&
      el.dataset.seat !== ''
    ) {
      dragInfo.sourceTable = parseInt(el.dataset.table, 10);
      dragInfo.sourceSeat = parseInt(el.dataset.seat, 10);
    } else {
      dragInfo.sourceTable = null;
      dragInfo.sourceSeat = null;
    }
    el.classList.add('dragging');
    ev.dataTransfer.setData('text/plain', dragInfo.name);
    ev.dataTransfer.effectAllowed = 'move';
  }

  function onDragEnd(ev) {
    ev.target.classList.remove('dragging');
    document.querySelectorAll('.seat-cell.drag-over').forEach(function (c) {
      c.classList.remove('drag-over');
    });
  }

  function onDragOver(ev) {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    var cell = ev.currentTarget;
    if (cell.classList.contains('seat-cell')) cell.classList.add('drag-over');
  }

  function onDragLeave(ev) {
    ev.currentTarget.classList.remove('drag-over');
  }

  function onDropPool(ev) {
    ev.preventDefault();
    var name = (ev.dataTransfer.getData('text/plain') || dragInfo.name || '').trim();
    if (!name) return;
    clearGuestFromAssignments(-1, -1, name);
    ev.currentTarget.classList.remove('drag-over');
    renderAll();
  }

  function onDropSeat(ev) {
    ev.preventDefault();
    var cell = ev.currentTarget;
    cell.classList.remove('drag-over');
    var name = (ev.dataTransfer.getData('text/plain') || dragInfo.name || '').trim();
    if (!name) return;
    var table = parseInt(cell.dataset.table, 10);
    var seat = parseInt(cell.dataset.seat, 10);
    var srcT = dragInfo.sourceTable;
    var srcS = dragInfo.sourceSeat;
    var occupant = (state.assignments[table][seat] || '').trim();

    if (
      srcT != null &&
      srcS != null &&
      occupant &&
      occupant.toLowerCase() !== name.toLowerCase()
    ) {
      if (srcT === table && srcS === seat) return;
      state.assignments[srcT][srcS] = occupant;
      state.assignments[table][seat] = name;
      renderAll();
      return;
    }

    clearGuestFromAssignments(table, seat, name);
    state.assignments[table][seat] = name;
    renderAll();
  }

  function renderPool() {
    var pool = $('#pool');
    pool.innerHTML = '';

    var assigned = collectAssignedNames(state.assignments);
    var names = state.allYesGuests.map(function (g) {
      return g.fullName;
    });
    names.forEach(function (fullName) {
      if (!fullName) return;
      var key = fullName.toLowerCase();
      if (assigned[key]) return;
      pool.appendChild(createChip(fullName, 'pool'));
    });
  }

  function renderRoom() {
    var room = $('#room');
    room.innerHTML = '';
    var rowTables = [5, 5, 5];
    var rowMeta = [
      { rowNum: 1, tableStart: 1, tableEnd: 5 },
      { rowNum: 2, tableStart: 6, tableEnd: 10 },
      { rowNum: 3, tableStart: 11, tableEnd: 15 }
    ];
    var tIndex = 1;
    rowTables.forEach(function (count, idx) {
      var meta = rowMeta[idx];
      var group = document.createElement('fieldset');
      group.className = 'room-row-group';
      var leg = document.createElement('legend');
      leg.className = 'room-row-legend';
      leg.textContent =
        'Row ' +
        meta.rowNum +
        ' — Tables ' +
        meta.tableStart +
        '–' +
        meta.tableEnd;
      group.appendChild(leg);

      var rowEl = document.createElement('div');
      rowEl.className = 'room-row';
      for (var i = 0; i < count; i++) {
        rowEl.appendChild(renderTableBlock(tIndex));
        tIndex++;
      }
      group.appendChild(rowEl);
      room.appendChild(group);
    });
  }

  function renderTableBlock(tableNum) {
    var wrap = document.createElement('div');
    wrap.className = 'table-block';
    if (YELLOW_FILL_TABLES[tableNum]) {
      wrap.classList.add('table-block--yellow');
    }
    var h = document.createElement('h3');
    h.textContent = 'Table ' + tableNum;
    wrap.appendChild(h);

    var grid = document.createElement('div');
    grid.className = 'seat-grid';

    SEAT_LAYOUT.forEach(function (row, rowIndex) {
      row.forEach(function (seatNum) {
        var cell = document.createElement('div');
        cell.className = 'seat-cell';
        cell.dataset.table = String(tableNum);
        cell.dataset.seat = String(seatNum);
        var guestName = state.assignments[tableNum][seatNum] || '';
        if (guestName) {
          cell.classList.add('has-guest');
          var chip = createChip(guestName, 'seat-' + tableNum + '-' + seatNum, {
            compact: true
          });
          chip.dataset.table = String(tableNum);
          chip.dataset.seat = String(seatNum);
          chip.draggable = !isMobilePickerMode();
          var lbl = document.createElement('span');
          lbl.className = 'seat-label';
          lbl.textContent = 'Seat ' + seatNum;
          cell.appendChild(lbl);
          cell.appendChild(chip);
        } else {
          var emptyLbl = document.createElement('span');
          emptyLbl.className = 'seat-label';
          emptyLbl.textContent = 'Seat ' + seatNum;
          cell.appendChild(emptyLbl);
        }
        cell.addEventListener('dragover', onDragOver);
        cell.addEventListener('dragleave', onDragLeave);
        cell.addEventListener('drop', onDropSeat);
        grid.appendChild(cell);
      });
      if (rowIndex === 0 && SEAT_LAYOUT.length > 1) {
        var spacer = document.createElement('div');
        spacer.className = 'table-spacer';
        spacer.setAttribute('aria-hidden', 'true');
        grid.appendChild(spacer);
      }
    });

    wrap.appendChild(grid);
    return wrap;
  }

  function renderAll() {
    renderPool();
    renderRoom();
  }

  var pendingSeat = null;

  var pendingOccupiedSeat = null;

  function getUnassignedNames() {
    var assigned = collectAssignedNames(state.assignments);
    var out = [];
    state.allYesGuests.forEach(function (g) {
      var fn = g.fullName;
      if (!fn) return;
      if (assigned[fn.toLowerCase()]) return;
      out.push(fn);
    });
    out.sort(function (a, b) {
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    });
    return out;
  }

  function openGuestPicker(table, seat) {
    closeSeatOccupantSheet();
    pendingSeat = { table: table, seat: seat };
    var picker = $('#guest-picker');
    $('#guest-picker-subtitle').textContent =
      'Table ' + table + ', seat ' + seat;
    picker.hidden = false;
    picker.setAttribute('aria-hidden', 'false');
    document.body.classList.add('guest-picker-open');
    var search = $('#guest-picker-search');
    search.value = '';
    renderGuestPickerList('');
    search.focus();
  }

  function closeGuestPicker() {
    pendingSeat = null;
    var picker = $('#guest-picker');
    picker.hidden = true;
    picker.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('guest-picker-open');
    $('#guest-picker-list').innerHTML = '';
  }

  function openSeatOccupantSheet(table, seat, guestName) {
    pendingOccupiedSeat = { table: table, seat: seat, guestName: guestName };
    closeGuestPicker();
    var sheet = $('#seat-occupant-sheet');
    $('#seat-occupant-name').textContent = guestName;
    $('#seat-occupant-meta').textContent =
      'Table ' + table + ', seat ' + seat;
    sheet.hidden = false;
    sheet.setAttribute('aria-hidden', 'false');
    document.body.classList.add('seat-occupant-open');
  }

  function closeSeatOccupantSheet() {
    pendingOccupiedSeat = null;
    var sheet = $('#seat-occupant-sheet');
    sheet.hidden = true;
    sheet.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('seat-occupant-open');
  }

  function removePendingOccupiedGuest() {
    if (!pendingOccupiedSeat) return;
    var t = pendingOccupiedSeat.table;
    var s = pendingOccupiedSeat.seat;
    state.assignments[t][s] = '';
    closeSeatOccupantSheet();
    renderAll();
  }

  function renderGuestPickerList(query) {
    var list = $('#guest-picker-list');
    list.innerHTML = '';
    var q = (query || '').trim().toLowerCase();
    var names = getUnassignedNames().filter(function (n) {
      return !q || n.toLowerCase().indexOf(q) !== -1;
    });
    if (names.length === 0) {
      var empty = document.createElement('p');
      empty.className = 'guest-picker-empty';
      empty.textContent = q
        ? 'No matching unassigned guests.'
        : 'No unassigned guests left.';
      list.appendChild(empty);
      return;
    }
    names.forEach(function (name) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'guest-picker-item';
      btn.textContent = name;
      btn.addEventListener('click', function () {
        if (!pendingSeat) return;
        var t = pendingSeat.table;
        var s = pendingSeat.seat;
        clearGuestFromAssignments(t, s, name);
        state.assignments[t][s] = name;
        closeGuestPicker();
        renderAll();
      });
      list.appendChild(btn);
    });
  }

  function onRoomClick(ev) {
    if (!isMobilePickerMode()) return;
    var cell = ev.target.closest('.seat-cell');
    if (!cell || !$('#room').contains(cell)) return;

    var chip = ev.target.closest('.guest-chip');
    if (cell.classList.contains('has-guest') && chip) {
      ev.preventDefault();
      ev.stopPropagation();
      var table = parseInt(cell.dataset.table, 10);
      var seat = parseInt(cell.dataset.seat, 10);
      var guestName =
        state.assignments[table][seat] || chip.dataset.guestName || '';
      if (!guestName) return;
      openSeatOccupantSheet(table, seat, guestName);
      return;
    }

    if (cell.classList.contains('has-guest')) return;
    if (ev.target.closest('.guest-chip')) return;
    var table = parseInt(cell.dataset.table, 10);
    var seat = parseInt(cell.dataset.seat, 10);
    if (table < 1 || seat < 1) return;
    ev.preventDefault();
    openGuestPicker(table, seat);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var pool = $('#pool');
    pool.addEventListener('dragover', onDragOver);
    pool.addEventListener('dragleave', onDragLeave);
    pool.addEventListener('drop', onDropPool);

    $('#room').addEventListener('click', onRoomClick);

    $('#guest-picker-search').addEventListener('input', function (e) {
      renderGuestPickerList(e.target.value);
    });
    $('#guest-picker-close').addEventListener('click', closeGuestPicker);
    $('#guest-picker-cancel').addEventListener('click', closeGuestPicker);
    $('.guest-picker-backdrop').addEventListener('click', closeGuestPicker);

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var picker = $('#guest-picker');
      var occ = $('#seat-occupant-sheet');
      if (!occ.hidden) closeSeatOccupantSheet();
      else if (!picker.hidden) closeGuestPicker();
    });

    $('#seat-occupant-remove').addEventListener('click', function () {
      removePendingOccupiedGuest();
    });
    $('#seat-occupant-close').addEventListener('click', closeSeatOccupantSheet);
    $('.seat-occupant-backdrop').addEventListener(
      'click',
      closeSeatOccupantSheet
    );

    $('#btn-save').addEventListener('click', function () {
      savePlan();
    });
    loadData();
  });
})();
