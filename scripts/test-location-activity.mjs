import assert from "node:assert/strict";
import {isLocationActiveNow, locationActivity, toLocalDateTimeInput} from "../locations.js";

const now = new Date(2026, 6, 7, 12, 0, 0);
const local = date => toLocalDateTimeInput(date);
const days = count => new Date(now.getFullYear(), now.getMonth(), now.getDate() + count, now.getHours(), now.getMinutes());

assert.equal(isLocationActiveNow({active:true,startDateTime:local(days(-1)),endDateTime:local(days(1)),autoActivityManaged:true},now),true,"Debe activar si la fecha actual cae dentro del rango");
assert.equal(locationActivity({active:true,startDateTime:local(days(1)),endDateTime:local(days(2)),autoActivityManaged:true},now).reason,"future","Debe quedar programada si todavía no empezó");
assert.equal(locationActivity({active:true,startDateTime:local(days(-3)),endDateTime:local(days(-1)),autoActivityManaged:true},now).reason,"ended","Debe vencer cuando ya pasó la fecha final");
assert.equal(locationActivity({active:false,startDateTime:local(days(-1)),endDateTime:local(days(1)),autoActivityManaged:true,manualInactiveUntil:days(1),manualInactiveDays:1},now).reason,"paused","La pausa manual debe bloquear aunque el rango esté vigente");
assert.equal(isLocationActiveNow({active:false,startDateTime:local(days(-1)),endDateTime:local(days(1)),autoActivityManaged:true,manualInactiveUntil:days(-1),manualInactiveDays:1},now),true,"Al vencer la pausa debe reactivarse si el rango sigue vigente");
assert.equal(isLocationActiveNow({active:false,startDateTime:local(days(-1)),endDateTime:local(days(1)),autoActivityManaged:true},now),false,"Una inactivación manual sin plazo debe permanecer inactiva");
assert.equal(isLocationActiveNow({active:false,manualInactiveUntil:days(-1),manualInactiveDays:1},now),true,"Una ubicación sin fecha debe reactivarse al vencer una pausa con plazo");

console.log("Ubicaciones: 7 escenarios de actividad OK");
