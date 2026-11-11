/**
 * 카나다라 웹앱 ↔ 구글 시트 연동 웹훅 (Webhook.gs)
 * - 기존 Code.gs(시트 등록 콘솔)와 별도 파일로 공존합니다.
 * - [프로젝트 설정 > 스크립트 속성]에 WEBHOOK_TOKEN 이 있어야 하며, 토큰이 다르면 모든 요청을 거부합니다.
 * - 배포: [배포 > 배포 관리 > 편집(연필) > 버전: 새 버전 > 배포] (URL 유지)
 *   처음 Drive 권한을 요청하면 [권한 검토 > 허용]을 눌러 주세요. (요율표 이미지 저장용)
 */

var WEBHOOK_TABS = ['05_요율표_마스터', '06_카드사별_프로모션_마스터', '07_거래내역_통합마스터', '08_분할결제_상세행_DB', '09_사용자_CM_마스터'];
var USERS_TAB = '09_사용자_CM_마스터';
var IMAGE_TAB = '10_요율표_이미지';
var IMAGE_HEADERS = ['이미지ID', '제목', '카드사태그', '실행일자', '안내메모', '등록자', '등록일시', 'Drive파일ID', '파일형식', '외부URL'];
var IMAGE_FOLDER = '카나다라_요율표_이미지';

function checkToken_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('WEBHOOK_TOKEN');
  if (!expected || token !== expected) throw new Error('unauthorized');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// 날짜 셀은 'yyyy-MM-dd'(시각이 있으면 'yyyy-MM-dd HH:mm')로, 나머지는 원래 값 그대로 (시트 표시 형식·지역 설정과 무관)
function plainValues_(sheet) {
  return sheet.getDataRange().getValues().map(function (row) {
    return row.map(function (c) {
      if (Object.prototype.toString.call(c) !== '[object Date]') return c;
      var hasTime = c.getHours() || c.getMinutes();
      return Utilities.formatDate(c, 'Asia/Seoul', hasTime ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd');
    });
  });
}

function imageSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(IMAGE_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(IMAGE_TAB);
    sheet.getRange(1, 1, 1, IMAGE_HEADERS.length).setValues([IMAGE_HEADERS]);
  }
  return sheet;
}

function imageFolder_() {
  var it = DriveApp.getFoldersByName(IMAGE_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(IMAGE_FOLDER);
}

function findImageRow_(sheet, id) {
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) return { index: i + 1, row: values[i] };
  }
  return null;
}

// 이 웹훅이 만든 폴더 안의 파일만 다룸 (다른 Drive 파일 접근 차단)
function ownedFile_(fileId) {
  var file = DriveApp.getFileById(fileId);
  var folderId = imageFolder_().getId();
  var parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === folderId) return file;
  }
  throw new Error('허용되지 않은 파일입니다.');
}

function doGet(e) {
  try {
    checkToken_(e.parameter.token);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (e.parameter.action === 'image') {
      var found = findImageRow_(imageSheet_(), e.parameter.id);
      if (!found || !found.row[7]) throw new Error('이미지를 찾을 수 없습니다.');
      var blob = ownedFile_(String(found.row[7])).getBlob();
      return json_({ ok: true, mimeType: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) });
    }

    var result = {};
    WEBHOOK_TABS.concat([IMAGE_TAB]).forEach(function (name) {
      var s = ss.getSheetByName(name);
      result[name] = s ? plainValues_(s) : [];
    });
    return json_({ ok: true, data: result });
  } catch (err) {
    return json_({ ok: false, error: err.toString() });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var body = JSON.parse(e.postData.contents);
    checkToken_(body.token);
    lock.waitLock(20000); // 동시에 들어온 저장끼리 섞이지 않게 한 번에 하나씩

    if (body.action === 'uploadImage') {
      var m = body.meta || {};
      var fileId = '';
      if (body.base64) {
        var blob = Utilities.newBlob(Utilities.base64Decode(body.base64), body.mimeType, m.id);
        fileId = imageFolder_().createFile(blob).getId();
      }
      imageSheet_().appendRow([m.id, m.title, m.cardCompanyTag, m.effectiveDate, m.note, m.uploadedBy, m.uploadedAt, fileId, body.mimeType || '', body.externalUrl || '']);
      return json_({ ok: true, fileId: fileId });
    }

    if (body.action === 'deleteImage') {
      var sheet = imageSheet_();
      var found = findImageRow_(sheet, body.id);
      if (found) {
        if (found.row[7]) ownedFile_(String(found.row[7])).setTrashed(true);
        sheet.deleteRow(found.index);
      }
      return json_({ ok: true });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ops = body.batchOps || [];
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (op.op !== 'write' || !op.range || !op.data) continue;
      var name = op.range.replace(/'/g, '').split('!')[0];
      if (WEBHOOK_TABS.indexOf(name) < 0) continue;
      var s = ss.getSheetByName(name);
      if (!s) continue;
      s.clearContents();
      if (op.data.length > 0 && op.data[0].length > 0) {
        var range = s.getRange(1, 1, op.data.length, op.data[0].length);
        // 계정 탭은 텍스트로 저장 (비밀번호·연락처의 앞자리 0이 숫자로 바뀌어 사라지는 것 방지)
        if (name === USERS_TAB) range.setNumberFormat('@');
        range.setValues(op.data);
      }
    }
    return json_({ ok: true, syncedAt: new Date().toISOString() });
  } catch (err) {
    return json_({ ok: false, error: err.toString() });
  } finally {
    lock.releaseLock();
  }
}
