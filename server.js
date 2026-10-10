// Anonka server — общий сервер для всех устройств. Запуск: node server.js
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data.json');
const rd = () => { let d; try { d = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) {} d = d || {}; d.users = d.users || []; d.msgs = d.msgs || []; d.groups = d.groups || []; d.channels = d.channels || []; d.gmsgs = d.gmsgs || []; d.cmsgs = d.cmsgs || []; d.n = d.n || { u: 0, m: 0 }; return d; };
let DB = rd(), dirty = false;
setInterval(() => { if (!dirty) return; dirty = false; try { fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(DB)); fs.renameSync(DB_FILE + '.tmp', DB_FILE); } catch (e) { console.error(e); } }, 1000);
process.on('SIGTERM', () => { try { fs.writeFileSync(DB_FILE, JSON.stringify(DB)); } catch (e) {} process.exit(0); });
const today = () => new Date().toDateString();
  const hash = s => { let h = 5381; for (const c of 'anonka|' + s) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return String(h); };
  const p2 = n => String(n).padStart(2, '0');
  const ts = t => { const d = new Date(t || Date.now()); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
  const E = (m, c = 400) => [c, { success: false, error: m }];
  const OK = (o = {}) => [200, { success: true, ...o }];
  const status = u => ((prem(u) && u.hide_ls) ? 'offline' : (Date.now() - (u.seen || 0) < 25000 ? 'online' : 'offline'));
  const TRIAL_MS = 3 * 24 * 3600 * 1000;
  const trialOn = u => !!(u.trial_until && u.trial_until > Date.now());
  const paidOn = u => !!(u.paid_until && u.paid_until > Date.now());
  const prem = u => !!(u && (u.is_premium || paidOn(u) || trialOn(u)));
  const pub = u => ({ id: u.id, username: u.username, first_name: u.first_name, last_name: u.last_name, bio: u.bio, avatar: u.avatar, theme: u.theme, status: status(u), coins: u.coins, is_premium: prem(u) ? 1 : 0, premium_name_color: u.premium_name_color || null, emoji_status: u.emoji_status || null, premium_until: paidOn(u) ? new Date(u.paid_until).toISOString() : ((!u.is_premium && trialOn(u)) ? new Date(u.trial_until).toISOString() : null), is_trial: (!u.is_premium && !paidOn(u) && trialOn(u)) ? 1 : 0, hide_last_seen: prem(u) && u.hide_ls ? 1 : 0, only_premium_msgs: prem(u) && u.pm_msgs ? 1 : 0, only_premium_voice: prem(u) && u.pm_voice ? 1 : 0, created_at: ts(u.created) });
  const xtra = b => { const o = {}; if (+b.reply_to) { o.reply_to = +b.reply_to; o.reply_name = String(b.reply_name || '').slice(0, 60); o.reply_text = String(b.reply_text || '').slice(0, 120); } if (b.fwd_name) o.fwd_name = String(b.fwd_name).slice(0, 60); return o; };
  const FREE_REACT = ['👍', '❤️', '🔥', '😂', '😮', '😢'];
  async function route(file, a, q, body, d, me, ctx) {
    if (file === 'auth.php') {
      if (a === 'register') {
        const un = (body.username || '').trim(), pw = body.password || '';
        if (!un || !pw) return E('Введите имя пользователя и пароль');
        if (un.length < 3) return E('Имя пользователя — минимум 3 символа');
        if (pw.length < 6) return E('Пароль — минимум 6 символов');
        if (d.users.some(u => u.username.toLowerCase() === un.toLowerCase())) return E('Это имя пользователя уже занято');
        d.users.push({ id: ++d.n.u, username: un, first_name: (body.first_name || '').trim(), last_name: (body.last_name || '').trim(), bio: '', avatar: 'default.png', theme: 'dark', coins: 500, is_premium: 0, trial_given: 1, trial_until: Date.now() + TRIAL_MS, ph: hash(pw), created: Date.now(), seen: 0 });
        return OK({ message: 'User registered successfully' });
      }
      if (a === 'login') {
        const u = d.users.find(x => x.username.toLowerCase() === (body.username || '').trim().toLowerCase());
        if (!u || u.ph !== hash(body.password || '')) return E('Неверное имя пользователя или пароль', 401);
        ctx.login = u.id; u.seen = Date.now();
        return OK({ user: pub(u) });
      }
      if (a === 'logout') { if (me) me.seen = 0; ctx.logout = true; return OK(); }
      if (a === 'check') return [200, me ? { authenticated: true, user: pub(me) } : { authenticated: false }];
    }
    if (!me) return E('Unauthorized', 401);
    if (/send/.test(a) && /\[ce:[ng]\d{1,3}\]/.test(JSON.stringify(body || {})) && !prem(me)) return E('Премиум-эмодзи доступны только с Anonka Premium', 403);
    const byId = id => d.users.find(u => u.id === +id);
    if (file === 'msgx.php') {
      const tp = body.type, coll = tp === 'group' ? d.gmsgs : tp === 'channel' ? d.cmsgs : d.msgs;
      const m = coll.find(x => x.id === +body.message_id);
      if (!m) return E('Сообщение не найдено', 404);
      if (tp !== 'group' && tp !== 'channel' && !(m.sender_id === me.id || m.receiver_id === me.id)) return E('Нет доступа', 403);
      if (a === 'edit') {
        if (m.sender_id !== me.id) return E('Можно изменять только свои сообщения', 403);
        if (m.message_type === 'voice') return E('Голосовые сообщения нельзя изменить');
        const t = String(body.message || '').trim(); if (!t) return E('Message is required');
        if (/\[ce:[ng]\d{1,3}\]/.test(t) && !prem(me)) return E('Премиум-эмодзи доступны только с Anonka Premium', 403);
        m.message = t; m.edited = 1; return OK({ message: t });
      }
      if (a === 'react') {
        const e = String(body.emoji || '').trim(); if (!e || e.length > 12) return E('Некорректная реакция');
        if (!prem(me) && !FREE_REACT.includes(e)) return E('Эта реакция доступна с Anonka Premium', 403);
        m.reactions = m.reactions || {};
        const mineR = Object.keys(m.reactions).filter(k => m.reactions[k].includes(me.id));
        const drop = k => { m.reactions[k] = m.reactions[k].filter(x => x !== me.id); if (!m.reactions[k].length) delete m.reactions[k]; };
        if (mineR.includes(e)) drop(e);
        else {
          if (mineR.length >= (prem(me) ? 3 : 1)) { if (prem(me)) return E('Можно поставить не больше 3 реакций'); drop(mineR[0]); }
          (m.reactions[e] = m.reactions[e] || []).push(me.id);
        }
        return OK({ reactions: m.reactions });
      }
    }
    if (file === 'users.php') {
      if (a === 'search') {
        const s = (q.get('query') || '').trim().replace(/^@+/, '').toLowerCase(); if (!s) return [200, []];
        const rank = u => { const n = u.username.toLowerCase(); return n === s ? 0 : n.startsWith(s) ? 1 : n.includes(s) ? 2 : 3; };
        return [200, d.users.filter(u => u.id !== me.id && (u.username + ' ' + u.first_name + ' ' + u.last_name).toLowerCase().includes(s)).sort((x, y) => rank(x) - rank(y)).slice(0, 20).map(pub)];
      }
      if (a === 'get' || a === 'profile') {
        const u = byId(q.get('id')); if (!u) return E('User not found', 404);
        return [200, { ...pub(u), messages_sent: d.msgs.filter(m => m.sender_id === u.id).length, groups_count: d.groups.filter(g => g.members.includes(u.id)).length }];
      }
      if (a === 'update') {
        const un = (body.username || '').trim(); if (un.length < 3) return E('Имя пользователя — минимум 3 символа');
        if (d.users.some(u => u.id !== me.id && u.username.toLowerCase() === un.toLowerCase())) return E('Это имя пользователя уже занято');
        const bioMax = prem(me) ? 140 : 70; if ((body.bio || '').trim().length > bioMax && (body.bio || '').trim() !== (me.bio || '')) return E('О себе: максимум ' + bioMax + ' символов' + (prem(me) ? '' : ' (140 — с Anonka Premium)'));
        Object.assign(me, { username: un, first_name: (body.first_name || '').trim(), last_name: (body.last_name || '').trim(), bio: (body.bio || '').trim(), theme: body.theme || me.theme });
        return OK();
      }
      if (a === 'set_premium_settings') {
        if (!prem(me)) return E('Доступно только пользователям Anonka Premium', 403);
        if ('emoji_status' in body) { const e = (body.emoji_status || '').trim(); if (e.length > 8) return E('Некорректный эмодзи-статус'); me.emoji_status = e || null; }
        if ('hide_last_seen' in body) me.hide_ls = body.hide_last_seen ? 1 : 0;
        if ('only_premium_msgs' in body) me.pm_msgs = body.only_premium_msgs ? 1 : 0;
        if ('only_premium_voice' in body) me.pm_voice = body.only_premium_voice ? 1 : 0;
        return OK({ user: pub(me) });
      }
      if (a === 'set_name_color') {
        if (!prem(me)) return E('Доступно только пользователям Anonka Premium', 403);
        if (!/^#[0-9a-fA-F]{6}$/.test(body.color || '')) return E('Некорректный формат цвета');
        me.premium_name_color = body.color; return OK({ premium_name_color: body.color });
      }
    }
    if (file === 'messages.php') {
      const mine = m => m.sender_id === me.id || m.receiver_id === me.id;
      if (a === 'send') {
        const rid = +body.receiver_id, type = body.message_type || 'text'; let text = (body.message || '').trim();
        if (!rid) return E('Receiver ID is required'); const rcv = byId(rid); if (!rcv) return E('Receiver not found', 404);
        if (prem(rcv) && !prem(me) && rcv.pm_msgs) return E('Пользователь принимает сообщения только от обладателей Anonka Premium', 403);
        if (prem(rcv) && !prem(me) && type === 'voice' && rcv.pm_voice) return E('Пользователь принимает голосовые только от обладателей Anonka Premium', 403);
        if (!text && type !== 'voice') return E('Message is required');
        d.msgs.push({ id: ++d.n.m, sender_id: me.id, receiver_id: rid, message: text || '🎤 Голосовое сообщение', message_type: type, attachment: body.attachment || null, is_read: 0, ...xtra(body), created_at: ts() });
        return OK({ message_id: d.n.m });
      }
      if (a === 'get') {
        const o = +q.get('user_id'); if (!o) return [200, []];
        const list = d.msgs.filter(m => (m.sender_id === me.id && m.receiver_id === o) || (m.sender_id === o && m.receiver_id === me.id));
        list.forEach(m => { if (m.sender_id === o) m.is_read = 1; });
        return [200, list.slice(-100).map(m => { const s = byId(m.sender_id) || {}; return { ...m, username: s.username, first_name: s.first_name, last_name: s.last_name, avatar: s.avatar, is_premium: prem(s) ? 1 : 0, premium_name_color: s.premium_name_color || null, emoji_status: s.emoji_status || null }; })];
      }
      if (a === 'get_contacts') {
        const map = {};
        d.msgs.filter(mine).forEach(m => { const o = m.sender_id === me.id ? m.receiver_id : m.sender_id; const c = map[o] || (map[o] = { id: o, last_message: '', unread_count: 0 }); c.last_message = m.created_at; if (m.receiver_id === me.id && !m.is_read) c.unread_count++; });
        return [200, Object.values(map).map(c => { const u = byId(c.id); return u ? { ...c, username: u.username, first_name: u.first_name, last_name: u.last_name, avatar: u.avatar, status: status(u), is_premium: prem(u) ? 1 : 0, premium_name_color: u.premium_name_color || null, emoji_status: u.emoji_status || null } : null; }).filter(Boolean).sort((x, y) => y.last_message.localeCompare(x.last_message))];
      }
      if (a === 'mark_read') { d.msgs.forEach(m => { if (m.sender_id === +body.user_id && m.receiver_id === me.id) m.is_read = 1; }); return OK(); }
    }
    if (file === 'daily_bonus.php') {
      if (a === 'check') return [200, { can_claim: me.bonus !== today(), claimed: me.bonus === today(), coins: me.coins }];
      if (a === 'claim') { if (me.bonus === today()) return E('Бонус уже получен сегодня'); me.bonus = today(); me.coins += 100; return OK({ coins: me.coins, amount: 100, bonus: 100 }); }
      if (a === 'history') return [200, []];
    }
    if (file === 'admin_levels.php' && a === 'my_level') return [200, { admin_level: 0 }];
    // ---------- группы и каналы ----------
    const SP = { 'groups.php': { c: 'groups', m: 'members', msgs: 'gmsgs', id: 'group_id', cnt: 'member_count', role: 'member' }, 'channels.php': { c: 'channels', m: 'subs', msgs: 'cmsgs', id: 'channel_id', cnt: 'subscribers', role: 'subscriber' } }[file];
    if (SP) {
      const A = { subscribe: 'join', unsubscribe: 'leave', add_subscriber: 'add_member', remove_subscriber: 'remove_member', subscribers: 'members' }[a] || a;
      const mid = +(body[SP.id] || q.get(SP.id) || q.get('id') || 0), tid = +(body.user_id || 0);
      const sp = d[SP.c].find(x => x.id === mid), tu = byId(tid);
      const own = s => s && s.creator_id === me.id, adm = s => s && (own(s) || s.admins.includes(me.id));
      const isAdm = (s, id) => s.creator_id === id || s.admins.includes(id);
      const row = s => ({ id: s.id, name: s.name, description: s.description, username: s.username, creator_id: s.creator_id, avatar: s.avatar, is_private: s.is_private ? 1 : 0, created_at: s.created_at, [SP.cnt]: s[SP.m].length });
      const taken = un => d.users.some(u => u.username.toLowerCase() === un.toLowerCase()) || d.groups.concat(d.channels).some(s => s.username && s.username.toLowerCase() === un.toLowerCase());
      const rx = /^[a-zA-Z0-9_]{5,32}$/, ISCH = file === 'channels.php';
      const lg = tx => { (sp.log = sp.log || []).push({ text: tx, created_at: ts() }); };
      if (A === 'create') {
        const name = (body.name || '').trim(), un = (body.username || '').trim();
        if (!name) return E(ISCH ? 'Введите название канала' : 'Введите название группы');
        if (ISCH && !un) return E('Юзернейм канала обязателен');
        if (un && !rx.test(un)) return E('Юзернейм должен быть 5-32 символа: латиница, цифры, подчёркивание');
        if (un && taken(un)) return E('Этот юзернейм уже занят');
        const s = { id: (d.n[SP.c] = (d.n[SP.c] || 0) + 1), name, description: (body.description || '').trim() || null, username: un || null, creator_id: me.id, avatar: null, is_private: !!body.is_private, created_at: ts(), admins: [me.id], bans: [], [SP.m]: [me.id] };
        d[SP.c].push(s); return OK({ [SP.id]: s.id });
      }
      if (A === 'check_username') { const un = (q.get('username') || '').trim(); return [200, rx.test(un) ? { available: !taken(un) } : { available: false, reason: 'format' }]; }
      if (A === 'my_groups' || A === 'my_channels') return [200, d[SP.c].filter(s => s[SP.m].includes(me.id)).sort((x, y) => y.created_at.localeCompare(x.created_at)).map(row)];
      if (A === 'all_channels') return [200, d.channels.filter(s => !s.is_private).map(row).sort((x, y) => y.subscribers - x.subscribers)];
      if (!sp) return E(ISCH ? 'Channel not found' : 'Group not found', 404);
      if (A === 'info') return [200, { ...row(sp), creator_name: (byId(sp.creator_id) || {}).username, is_subscribed: sp[SP.m].includes(me.id), is_member: sp[SP.m].includes(me.id) }];
      if (A === 'join') { if (sp.bans.includes(me.id)) return E('Вы заблокированы', 403); if (!sp[SP.m].includes(me.id)) sp[SP.m].push(me.id); return OK(); }
      if (A === 'leave') { sp[SP.m] = sp[SP.m].filter(x => x !== me.id); sp.admins = sp.admins.filter(x => x !== me.id || own(sp)); return OK(); }
      if (A === 'members') return [200, sp[SP.m].map(byId).filter(Boolean).map(u => ({ id: u.id, username: u.username, first_name: u.first_name, last_name: u.last_name, avatar: u.avatar, status: status(u), is_premium: prem(u) ? 1 : 0, premium_name_color: u.premium_name_color || null, emoji_status: u.emoji_status || null, role: u.id === sp.creator_id ? 'owner' : sp.admins.includes(u.id) ? 'admin' : SP.role })).sort((x, y) => { const r = { owner: 0, admin: 1 }; return (r[x.role] ?? 2) - (r[y.role] ?? 2) || x.username.localeCompare(y.username); })];
      if (A === 'send_message') {
        const type = body.message_type || 'text', text = (body.message || '').trim();
        if (sp.bans.includes(me.id)) return E('Вы заблокированы', 403);
        if (!sp[SP.m].includes(me.id)) return E(ISCH ? 'Вы не подписаны на канал' : 'Вы не участник группы', 403);
        if (!text && type !== 'voice') return E('Message is required');
        d[SP.msgs].push({ id: ++d.n.m, [SP.id]: sp.id, sender_id: me.id, message: text || '🎤 Голосовое сообщение', message_type: type, attachment: body.attachment || null, ...xtra(body), created_at: ts() });
        return OK({ message_id: d.n.m });
      }
      if (A === 'get_messages') return [200, d[SP.msgs].filter(m => m[SP.id] === sp.id).slice(-100).map(m => { const s = byId(m.sender_id) || {}; return { ...m, username: s.username, first_name: s.first_name, last_name: s.last_name, avatar: s.avatar, is_premium: prem(s) ? 1 : 0, premium_name_color: s.premium_name_color || null, emoji_status: s.emoji_status || null }; })];
      if (A === 'update_avatar') { if (!adm(sp)) return E('Только админы могут менять аватар', 403); if (!body._img) return E('Не удалось загрузить изображение'); sp.avatar = body._img; return OK({ avatar: sp.avatar }); }
      if (ISCH && A === 'update') {
        if (!adm(sp)) return E('Только админы могут менять канал', 403);
        const name = (body.name || '').trim(); if (!name) return E('Введите название канала');
        const ds = (body.description || '').trim() || null;
        if (name !== sp.name) lg('Название изменено: «' + sp.name + '» → «' + name + '»');
        if (ds !== sp.description) lg('Описание изменено');
        sp.name = name; sp.description = ds; return OK();
      }
      if (ISCH && A === 'set_type') {
        if (!own(sp)) return E('Только владелец может менять тип канала', 403);
        const un = (body.username || '').trim(), priv = !!body.is_private;
        if (!priv || un) {
          if (!rx.test(un)) return E('Юзернейм должен быть 5-32 символа: латиница, цифры, подчёркивание');
          if (un.toLowerCase() !== (sp.username || '').toLowerCase() && taken(un)) return E('Этот юзернейм уже занят');
          sp.username = un;
        }
        if (priv !== !!sp.is_private) lg('Тип канала изменён: ' + (priv ? 'приватный' : 'публичный'));
        sp.is_private = priv; return OK();
      }
      if (ISCH && A === 'delete') {
        if (!own(sp)) return E('Только владелец может удалить канал', 403);
        d.channels = d.channels.filter(x => x.id !== sp.id); d.cmsgs = d.cmsgs.filter(m => m.channel_id !== sp.id); return OK();
      }
      if (ISCH && A === 'bans') { if (!adm(sp)) return E('Нет доступа', 403); return [200, sp.bans.map(byId).filter(Boolean).map(u => ({ id: u.id, username: u.username, first_name: u.first_name, last_name: u.last_name, avatar: u.avatar }))]; }
      if (ISCH && A === 'stats') { if (!adm(sp)) return E('Нет доступа', 403); return [200, { subscribers: sp.subs.length, admins: sp.admins.length, bans: sp.bans.length, messages: d.cmsgs.filter(m => m.channel_id === sp.id).length, created_at: sp.created_at }]; }
      if (ISCH && A === 'log') { if (!adm(sp)) return E('Нет доступа', 403); return [200, (sp.log || []).slice().reverse().slice(0, 50)]; }
      if (!tid) return E('User ID required');
      if (A === 'add_member') { if (!adm(sp)) return E('Только админы могут добавлять', 403); if (!tu) return E('User not found', 404); if (sp.bans.includes(tid)) return E('Пользователь заблокирован', 403); if (!sp[SP.m].includes(tid)) sp[SP.m].push(tid); return OK(); }
      if (A === 'make_admin') { if (!own(sp)) return E('Только владелец может назначать админов', 403); if (!sp[SP.m].includes(tid)) return E('Пользователь не состоит здесь', 404); if (!sp.admins.includes(tid)) { sp.admins.push(tid); lg('Назначен администратор: @' + tu.username); } return OK(); }
      if (A === 'remove_admin') { if (!own(sp)) return E('Только владелец может снимать админов', 403); if (tid !== sp.creator_id) { sp.admins = sp.admins.filter(x => x !== tid); lg('Снят администратор: @' + (tu ? tu.username : tid)); } return OK(); }
      if (A === 'remove_member' || A === 'ban_user') {
        if (!adm(sp)) return E('Только админы могут это делать', 403);
        if (tid === sp.creator_id) return E('Нельзя трогать владельца', 403);
        if (!own(sp) && isAdm(sp, tid)) return E('Только владелец может трогать админов', 403);
        sp[SP.m] = sp[SP.m].filter(x => x !== tid); sp.admins = sp.admins.filter(x => x !== tid);
        if (A === 'ban_user' && !sp.bans.includes(tid)) sp.bans.push(tid);
        lg((A === 'ban_user' ? 'Заблокирован: @' : 'Удалён: @') + (tu ? tu.username : tid)); return OK();
      }
      if (A === 'unban_user') { if (!adm(sp)) return E('Только админы могут разбанивать', 403); sp.bans = sp.bans.filter(x => x !== tid); lg('Разбанен: @' + (tu ? tu.username : tid)); return OK(); }
    }
    // ---------- подарки ----------
    if (file === 'gifts.php') {
      if (!d.gifts) {
        const C = (n, ds, p, im, bg) => ({ name: n, description: ds, type: 'common', price: p, image: im, background_color: bg, max_supply: null, is_active: 1 });
        const N = (n, p, im, bg, mx, act = 1) => ({ name: n, description: 'Лимитированный NFT-подарок', type: 'collectible', price: p, image: im, background_color: bg, max_supply: mx, is_active: act });
        d.gifts = [C('Плюшевый мишка', 'Милый плюшевый друг', 15, 'gift_teddybear.png', '#e8a87c'), C('Сердце', 'Признание в симпатии', 15, 'gift_heart.png', '#ff6b81'), C('Роза', 'Классический знак внимания', 25, 'gift_rose.png', '#e0559c'), C('Подарок', 'Универсальный сюрприз', 25, 'gift_gift.png', '#9b59b6'), C('Ракета', 'Для амбициозных', 40, 'gift_rocket.png', '#8e44ad'), C('Торт', 'Для дня рождения', 50, 'gift_cake.png', '#f4a261'), C('Кубок', 'За достижения', 50, 'gift_trophy.png', '#e8b923'), C('Шампанское', 'Для праздника', 60, 'gift_champagne.png', '#d4a017'), C('Кольцо', 'Особенный знак', 100, 'gift_ring.png', '#c9a24b'), C('Бриллиант', 'Роскошный подарок', 150, 'gift_diamond.png', '#5bc0eb'), N('Мороженое', 450, 'gift_icecream.png', '#f4a9c4', 10), N('Только владельцев', 1000, 'gift_owners.png', '#f2c94c', 3), N('Змейка', 5000, 'gift_snake.png', '#8fce5c', 5), N('Бета', 0, 'gift_beta.png', '#7ee8c7', null, 0)].map((g, i) => ({ id: i + 1, pattern_emojis: null, model_image: null, collectible_available_date: null, created_at: ts(), ...g }));
        d.ug = []; d.gn = [];
      }
      const gid = +body.gift_id, g = d.gifts.find(x => x.id === gid && x.is_active), sold = x => d.ug.filter(u => u.gift_id === x).length;
      const ugRow = u => { const g2 = d.gifts.find(x => x.id === u.gift_id), s = byId(u.sender_id) || {}; return { ...g2, user_gift_id: u.id, user_id: u.user_id, sender_id: u.sender_id, message: u.message, is_pinned: u.is_pinned, is_equipped: u.is_equipped, purchased_at: u.purchased_at, sender_username: s.username, sender_first_name: s.first_name, sender_last_name: s.last_name, sender_avatar: s.avatar }; };
      if (a === 'get_gifts') {
        const t = q.get('type') || 'all', lim = +q.get('limit') || 50, off = +q.get('offset') || 0;
        const all = d.gifts.filter(x => x.is_active && (t === 'all' || x.type === t)).sort((x, y) => (x.type < y.type ? 1 : x.type > y.type ? -1 : y.id - x.id));
        return [200, { gifts: all.slice(off, off + lim).map(x => ({ ...x, sold_count: x.max_supply != null ? sold(x.id) : null, remaining: x.max_supply != null ? Math.max(0, x.max_supply - sold(x.id)) : null })), total: all.length, limit: lim, offset: off }];
      }
      if (a === 'my_gifts' || a === 'get_user_gifts') { const uid2 = a === 'my_gifts' ? me.id : +q.get('user_id'); return [200, d.ug.filter(u => u.user_id === uid2).sort((x, y) => y.id - x.id).map(ugRow)]; }
      if (a === 'get_notifications') return [200, d.gn.filter(n => n.user_id === me.id && !n.is_read).sort((x, y) => y.id - x.id).map(n => { const g2 = d.gifts.find(x => x.id === n.gift_id), s = byId(n.sender_id) || {}; return { ...n, gift_name: g2.name, gift_image: g2.image, sender_username: s.username, sender_first_name: s.first_name, sender_last_name: s.last_name, sender_avatar: s.avatar }; })];
      if (a === 'mark_notification_read') { const n = d.gn.find(x => x.id === +body.notification_id && x.user_id === me.id); if (n) n.is_read = 1; return OK(); }
      if (a === 'buy' || a === 'buy_and_send') {
        if (!gid) return E('Gift ID required'); if (!g) return E('Подарок не найден', 404);
        const rid = a === 'buy' ? me.id : +body.receiver_id; if (!rid || !byId(rid)) return E('Получатель не найден', 404);
        if (g.type === 'collectible') {
          if (g.max_supply != null && sold(gid) >= g.max_supply) return E('Этот NFT-подарок распродан (' + g.max_supply + ' шт.)');
          if (d.ug.some(u => u.user_id === rid && u.gift_id === gid)) return E(rid === me.id ? 'У вас уже есть этот подарок' : 'У пользователя уже есть этот подарок');
        }
        if (me.coins < g.price) return E('Не хватает Anon Star. Нужно ' + g.price);
        me.coins -= g.price;
        d.ug.push({ id: (d.n.ug = (d.n.ug || 0) + 1), user_id: rid, sender_id: me.id, gift_id: gid, message: a === 'buy' ? 'Купил(а) для себя' : (body.message || '').trim(), is_pinned: 0, is_equipped: 0, purchased_at: ts() });
        if (a === 'buy_and_send') d.gn.push({ id: (d.n.gn = (d.n.gn || 0) + 1), user_id: rid, gift_id: gid, sender_id: me.id, message: (body.message || '').trim() || 'Вам подарили подарок! 🎁', is_read: 0, created_at: ts() });
        return OK({ message: 'OK', coins: me.coins });
      }
      if (a === 'pin_gift' || a === 'equip_gift') {
        const u = d.ug.find(x => x.id === +body.user_gift_id && x.user_id === me.id); if (!u) return E('Подарок не найден', 404);
        const g2 = d.gifts.find(x => x.id === u.gift_id); if (g2.type !== 'collectible') return E('Только NFT-подарки можно ' + (a === 'pin_gift' ? 'закрепить' : 'надеть'));
        const f = a === 'pin_gift' ? 'is_pinned' : 'is_equipped'; d.ug.forEach(x => { if (x.user_id === me.id) x[f] = 0; }); u[f] = 1;
        return OK({ message: 'OK', background_color: g2.background_color, pattern_emojis: g2.pattern_emojis, model_image: g2.model_image });
      }
    }
    if (file === 'calls.php') return a === 'poll' ? [200, []] : OK();
    if (a === 'check_username') return [200, { available: true, success: true }];
    if (/^(my_|all_|get_|poll|history|list|members|subscribers|search_users)/.test(a)) return [200, []];
    return E('Эта функция недоступна в автономной версии Anonka');
  }

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' };
http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (req.method === 'GET') { res.writeHead(200, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Anonka server OK'); }
  let raw = '', size = 0;
  req.on('data', c => { size += c.length; if (size > 12e6) { req.destroy(); } else raw += c; });
  req.on('end', async () => {
    let out;
    try {
      const r = JSON.parse(raw || '{}'), file = String(r.file || ''), a = String(r.action || ''), q = new URLSearchParams(r.query || ''), body = r.body || {};
      const d = DB;
      d.users.forEach(x => { if (x.username && x.username.toLowerCase() === 'sql' && !x.year_given) { x.year_given = 1; x.paid_until = Date.now() + 365 * 24 * 3600 * 1000; } if (!x.trial_given) { x.trial_given = 1; x.trial_until = Date.now() + TRIAL_MS; } });
      const me = d.users.find(x => x.id === (+r.uid || 0)) || null; if (me) me.seen = Date.now();
      const ctx = {}; let rs;
      if (file === 'upload.php') {
        const img = body._img;
        if (!me) rs = E('Unauthorized', 401);
        else if (!img || typeof img !== 'string' || !/^data:image\//.test(img)) rs = E('Не удалось загрузить изображение');
        else { me.avatar = img; rs = OK({ avatar: img, filename: img, url: img }); }
      } else rs = await route(file, a, q, body, d, me, ctx);
      dirty = true;
      out = { status: rs[0], json: rs[1] };
      if (ctx.login) out.uid = ctx.login;
      if (ctx.logout) out.logout = true;
    } catch (e) { console.error(e); out = { status: 500, json: { success: false, error: 'Ошибка сервера: ' + e.message } }; }
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(out));
  });
}).listen(PORT, () => console.log('Anonka server on :' + PORT));
