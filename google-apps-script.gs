const SHEET_NAME = "picks";
const USERS = ["Дима", "Илья", "Саша", "Саша GMC", "Паша", "Андрей"];

function doGet() {
  return jsonResponse(getPicks());
}

function doPost(e) {
  const params = e.parameter || {};
  const user = String(params.user || "").trim();
  const team = String(params.team || "").trim();
  const bestScore = params.bestScore === "" ? "" : Number(params.bestScore);
  const tierOverride = String(params.tierOverride || "false") === "true";

  if (!USERS.includes(user)) {
    return jsonResponse({ ok: false, error: "Unknown user" });
  }

  const sheet = getSheet();
  const rows = sheet.getDataRange().getValues();
  const userRowIndex = rows.findIndex((row, index) => index > 0 && row[0] === user);
  const row = [user, team, bestScore, tierOverride, new Date().toISOString()];

  if (userRowIndex === -1) {
    sheet.appendRow(row);
  } else {
    sheet.getRange(userRowIndex + 1, 1, 1, row.length).setValues([row]);
  }

  return jsonResponse({ ok: true, ...getPicks() });
}

function getPicks() {
  const sheet = getSheet();
  const rows = sheet.getDataRange().getValues().slice(1);
  const users = {};

  USERS.forEach((user) => {
    users[user] = {
      team: "",
      bestScore: null,
      tierOverride: false,
      updatedAt: "",
    };
  });

  rows.forEach((row) => {
    const user = row[0];
    if (!USERS.includes(user)) return;

    users[user] = {
      team: row[1] || "",
      bestScore: row[2] === "" ? null : Number(row[2]),
      tierOverride: row[3] === true || row[3] === "true",
      updatedAt: row[4] || "",
    };
  });

  return { ok: true, users };
}

function getSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["user", "team", "bestScore", "tierOverride", "updatedAt"]);
  }

  return sheet;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
