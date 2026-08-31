const test = require('node:test');
const assert = require('node:assert/strict');
const thermal = require('../public/js/thermal-schedule.js');

const day = iso => ({ iso, day: Number(iso.slice(-2)) });
const employee = (overrides={}) => ({
  id: 1,
  registration: '0001',
  shift_name: '1º Turno',
  shift_senior_code: '46',
  shift_description: '08:00 - 12:00 - 13:00 - 17:00',
  point_schedules: {},
  ...overrides
});

test('regras oficiais permanecem fixadas em 100/20 minutos', () => {
  assert.equal(thermal.REST_AFTER_MINUTES, 100);
  assert.equal(thermal.REST_DURATION_MINUTES, 20);
  assert.equal(thermal.MAX_REST_DURATION_MINUTES, 25);
  assert.equal(thermal.MAX_VARIATION_MINUTES, 15);
});

test('interpreta jornada normal com intervalo de refeição', () => {
  assert.deepEqual(thermal.parseShiftSchedule('08:00 - 12:00 - 13:00 - 17:00'), {
    start: 480, breakStart: 720, breakEnd: 780, end: 1020
  });
});

test('interpreta corretamente jornada do 3º turno atravessando meia-noite', () => {
  assert.deepEqual(thermal.parseShiftSchedule('20:30 - 23:00 - 00:00 - 04:30'), {
    start: 1230, breakStart: 1380, breakEnd: 1440, end: 1710
  });
});

test('refeição separa os períodos e nenhum repouso atravessa o intervalo', () => {
  const rests = thermal.dynamicPointRests('08:00 - 12:00 - 13:00 - 17:00');
  assert.ok(rests.length > 0);
  for (const rest of rests) {
    const beforeMeal = rest.start >= 480 && rest.end <= 720;
    const afterMeal = rest.start >= 780 && rest.end <= 1020;
    assert.ok(beforeMeal || afterMeal, `repouso atravessou refeição: ${JSON.stringify(rest)}`);
    assert.equal(rest.duration, 20);
  }
});

test('jornada parcial de duas marcações é aceita e respeita a saída real', () => {
  const rests = thermal.dynamicPointRests('08:00 - 12:00');
  assert.ok(rests.length > 0);
  assert.ok(rests.every(rest => rest.start >= 480 && rest.end <= 720));
});

test('jornada curta sem tempo suficiente não cria repouso', () => {
  assert.deepEqual(thermal.dynamicPointRests('08:00 - 09:30'), []);
});

test('sem ponto do dia, geração automática não cria marcação', () => {
  const plan = thermal.buildMonthPlan([employee()], [day('2026-08-01')], { usePointData: true });
  assert.equal(plan.has('1|2026-08-01'), false);
});

test('jornada normal é limitada a no máximo 3 repousos na geração mensal', () => {
  const e = employee({ point_schedules: { '2026-08-03': '08:00 - 12:00 - 13:00 - 17:00' } });
  const plan = thermal.buildMonthPlan([e], [day('2026-08-03')], { usePointData: true });
  const rests = plan.get('1|2026-08-03');
  assert.ok(rests);
  assert.ok(rests.length <= 3);
  assert.ok(rests.every(rest => rest.duration === 20));
});

test('hora extra pode liberar o 4º repouso, mas nunca ultrapassa 4', () => {
  const e = employee({ point_schedules: { '2026-08-04': '08:00 - 12:00 - 13:00 - 20:00' } });
  const plan = thermal.buildMonthPlan([e], [day('2026-08-04')], { usePointData: true });
  const rests = plan.get('1|2026-08-04');
  assert.equal(rests.length, 4);
});

test('identifica 3º turno por nome ou código Senior 56', () => {
  assert.equal(thermal.isThirdShift({ shift_name: '3º Turno' }), true);
  assert.equal(thermal.isThirdShift({ shift_senior_code: '056' }), true);
  assert.equal(thermal.isThirdShift({ shift_name: '1º Turno', shift_senior_code: '46' }), false);
});

test('3º turno desloca a data de referência do ponto em +1 dia', () => {
  assert.equal(thermal.pointReportDate('2026-08-31', { shift_senior_code: '56' }), '2026-09-01');
  assert.equal(thermal.pointReportDate('2026-08-31', { shift_senior_code: '46' }), '2026-08-31');
});

test('formatação de horário suporta minutos após meia-noite', () => {
  assert.equal(thermal.formatMinutes(1470), '00:30');
});
