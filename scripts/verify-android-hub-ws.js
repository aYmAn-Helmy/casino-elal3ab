'use strict';

const assert = require('node:assert/strict');
const WebSocket = require('ws');
const endpoint = 'ws://127.0.0.1:3000/ws';

async function newClient() {
  const ws = new WebSocket(endpoint, { headers: { Origin: 'http://127.0.0.1:3000' } });
  const inbox = [];
  const waiters = [];
  ws.on('message', raw => {
    const msg = JSON.parse(raw.toString());
    const idx = waiters.findIndex(w => w.matches(msg));
    if (idx >= 0) {
      const w = waiters.splice(idx, 1)[0];
      clearTimeout(w.timer);
      w.resolve(msg);
    } else inbox.push(msg);
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return {
    send(x) { ws.send(JSON.stringify(x)); },
    expect(predicate, ms = 6000) {
      const idx = inbox.findIndex(predicate);
      if (idx >= 0) return Promise.resolve(inbox.splice(idx, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { matches: predicate, resolve };
        waiter.timer = setTimeout(() => {
          const n = waiters.indexOf(waiter);
          if (n >= 0) waiters.splice(n, 1);
          reject(new Error('Timeout for Android Hub event'));
        }, ms);
        waiters.push(waiter);
      });
    },
    close() { ws.close(); }
  };
}

(async () => {
  const clients = [];
  try {
    const host = await newClient(), a = await newClient(), b = await newClient();
    clients.push(host, a, b);
    const initial = await host.expect(m => m.type === 'state');
    assert.equal(initial.state.questionStats.total, 1000);
    host.send({type:'host-login',pin:process.env.HUB_PIN});
    await host.expect(m => m.type === 'host-ok');
    a.send({type:'join',name:'أحمد'});
    const playerA = (await a.expect(m => m.type === 'joined')).player;
    b.send({type:'join',name:'سارة'});
    const playerB = (await b.expect(m => m.type === 'joined')).player;
    assert.notEqual(playerA.id, playerB.id);
    host.send({type:'host-action',action:'next-question',category:'وصف أكلة'});
    const question = await host.expect(m => m.type === 'host-question' && m.question?.category === 'وصف أكلة');
    assert.ok(question.question.answer, 'Only host sees the answer');
    const publicState = await b.expect(m => m.type === 'state' && m.state.question?.category === 'وصف أكلة');
    assert.equal(publicState.state.question.answer, undefined, 'No answer leaked to players');

    host.send({type:'host-action',action:'open'});
    const opened = await a.expect(m => m.type === 'state' && m.state.phase === 'open');
    a.send({type:'buzz',roundId:opened.state.roundId});
    assert.equal((await a.expect(m => m.type === 'buzz-result')).ok, true);
    b.send({type:'buzz',roundId:opened.state.roundId});
    assert.equal((await b.expect(m => m.type === 'buzz-result')).ok, false);
    host.send({type:'host-action',action:'correct'});
    const awarded = await a.expect(m => m.type === 'answer-correct');
    assert.equal(awarded.points, 1);
    const scored = await host.expect(m => m.type === 'state' && m.state.players.some(p => p.id === playerA.id && p.score === 1));
    assert.equal(scored.state.players.find(p => p.id === playerA.id).score, 1);

    host.send({type:'host-action',action:'open'});
    const next = await b.expect(m => m.type === 'state' && m.state.phase === 'open' && m.state.roundId > opened.state.roundId);
    a.send({type:'buzz',roundId:next.state.roundId});
    assert.equal((await a.expect(m => m.type === 'buzz-result' && m.ok)).ok, true);
    host.send({type:'host-action',action:'wrong'});
    const reopened = await b.expect(m => m.type === 'state' && m.state.phase === 'open' && m.state.roundId > next.state.roundId);
    assert.equal(reopened.state.players.find(p => p.id === playerA.id).score, 0);
    a.send({type:'buzz',roundId:reopened.state.roundId});
    assert.equal((await a.expect(m => m.type === 'buzz-result' && m.ok)).ok, true, 'same player re-buzzes after wrong');
    host.send({type:'host-action',action:'wrong'});
    await host.expect(m => m.type === 'state' && m.state.players.some(p => p.id === playerA.id && p.score === -1));

    a.send({type:'host-action',action:'yellow-card',playerId:playerB.id});
    const denied = await a.expect(m => m.type === 'error');
    assert.match(denied.message, /المذيع/);
    host.send({type:'host-action',action:'yellow-card',playerId:playerB.id});
    const yellow = await host.expect(m => m.type === 'state' && m.state.players.some(p => p.id === playerB.id && p.yellow_cards === 1));
    assert.equal(yellow.state.players.find(p => p.id === playerB.id).score, -1);
    host.send({type:'host-action',action:'red-card',playerId:playerB.id});
    const red = await host.expect(m => m.type === 'state' && m.state.players.some(p => p.id === playerB.id && p.red_cards === 1));
    assert.equal(red.state.players.find(p => p.id === playerB.id).score, -4);
    console.log('Real Android emulator: joining, buzzer, correct +1, wrong -1, rebuzz, cards, host auth and private answers all passed.');
  } finally {
    for (const client of clients) client.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
