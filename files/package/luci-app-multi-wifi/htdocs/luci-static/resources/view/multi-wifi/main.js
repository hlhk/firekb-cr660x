'require view';
'require form';
'require uci';
'require rpc';
'require ui';
'require fs';
'require tools.widgets as widgets';

/*
 * Multi WiFi - 批量创建多个 WiFi SSID (VAP)
 *
 * 硬件实测上限 (MT7981 / mt798x-wmac):
 *   2.4G (phy0): 主 SSID + 最多 14 个额外 SSID = 15 总数
 *   5G   (phy1): 主 SSID + 最多 15 个额外 SSID = 16 总数
 * 超过会导致整个频段的 hostapd 崩溃，主 SSID 也会掉。
 * 因此 UI 上给出硬性限制与风险提示。
 */

/* ---------- 硬件能力表（与实测结果一致） ---------- */
var HW_LIMITS = {
	'2g': { max_total: 15, max_extra: 14, phy: 'phy0', label: '2.4G' },
	'5g': { max_total: 16, max_extra: 15, phy: 'phy1', label: '5G'   }
};

/* 建议安全值（留 2 个余量） */
var SAFE_MARGIN = 2;

/* 我们自己的 UCI section 前缀，避免和系统 wifi-iface 冲突 */
var SEC_PREFIX = 'mw_';

var callWirelessStatus = rpc.declare({
	object: 'network.wireless',
	method: 'status',
	expect: { '': {} }
});

/* network.wireless 没有 reload 方法，用 reconf 重载单个 radio */
var callWirelessReconf = rpc.declare({
	object: 'network.wireless',
	method: 'reconf',
	params: [ 'device' ],
	expect: { '': {} }
});

var callIwinfoInfo = rpc.declare({
	object: 'iwinfo',
	method: 'info',
	params: [ 'device' ],
	expect: { '': {} }
});

/* ---------- 工具函数 ---------- */

/* 取得所有 radio（wifi-device），附带频段 */
function getRadios() {
	var out = [];
	uci.sections('wireless', 'wifi-device', function(s) {
		out.push({
			name: s['.name'],
			band: s.band || guessBandFromHwmode(s),
			htmode: s.htmode || '',
			channel: s.channel || 'auto',
			disabled: s.disabled == '1'
		});
	});
	return out;
}

function guessBandFromHwmode(s) {
	if (s.hwmode == 'a')
		return '5g';
	if (s.hwmode == 'g' || s.hwmode == 'b')
		return '2g';
	return '2g';
}

/* 统计某个 radio 上已有的 AP 数量（含主 SSID 与我们创建的） */
function countAPsOnRadio(radioName) {
	var n = 0;
	uci.sections('wireless', 'wifi-iface', function(s) {
		if (s.device == radioName && (s.mode == 'ap' || !s.mode))
			n++;
	});
	return n;
}

/* 统计本插件创建的 SSID（按 radio 分组） */
function countManagedOnRadio(radioName) {
	var n = 0;
	uci.sections('wireless', 'wifi-iface', function(s) {
		if (s['.name'].indexOf(SEC_PREFIX) == 0 &&
		    s.device == radioName &&
		    s.mw_managed == '1')
			n++;
	});
	return n;
}

function getBandLimit(radio) {
	var b = radio.band == '5g' ? '5g' : '2g';
	return HW_LIMITS[b];
}

/* ---------- 主视图 ---------- */
return view.extend({

	load: function() {
		return Promise.all([
			uci.load('wireless'),
			uci.load('network'),
			uci.load('dhcp'),
			uci.load('firewall'),
			uci.load('multiwifi').catch(function() { return null; }),
			callWirelessStatus().catch(function() { return {}; })
		]);
	},

	/* 频率/信号格式化 */
	render: function(data) {
		var self = this;
		var radios = getRadios();

		/* ---- 顶部说明 ---- */
		var overview = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Multi WiFi — 批量创建多个 SSID')),
			E('p', { 'class': 'cbi-section-descr' }, [
				_('在此一次性创建多个 WiFi 信号（VAP）。填写数量后点「生成」即可批量创建，' +
				  '生成的 SSID 可在下方逐个修改名称和密码。')
			]),
			/* 环境自检状态条 */
			E('div', { 'id': 'mw-health', 'style':
				'margin-top:10px;padding:10px 14px;border-radius:4px;' +
				'background:#f5f5f5;border-left:4px solid #999;font-size:13px' }, [
				E('span', { 'id': 'mw-health-text' }, _('正在检测环境…')),
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'style': 'margin-left:12px;padding:2px 10px;font-size:12px',
					'click': ui.createHandlerFn(this, function() { return self.runCheck(true); })
				}, _('重新检测')),
				E('button', {
					'class': 'btn',
					'id': 'mw-health-toggle',
					'style': 'margin-left:6px;padding:2px 10px;font-size:12px;display:none',
					'click': function() {
						var d = document.getElementById('mw-health-detail');
						var b = document.getElementById('mw-health-toggle');
						if (!d) return;
						var show = d.style.display == 'none';
						d.style.display = show ? 'block' : 'none';
						b.textContent = show ? _('收起详情') : _('查看详情');
					}
				}, _('查看详情'))
			]),
			E('div', { 'id': 'mw-health-detail', 'style':
				'display:none;margin-top:8px;padding:8px 10px;background:#fff;' +
				'border:1px solid #ddd;border-radius:3px;font-size:12px;' +
				'max-height:320px;overflow-y:auto' })
		]);

		/* ---- 硬件上限提示表 ---- */
		var limitRows = [];
		radios.forEach(function(r) {
			var lim = getBandLimit(r);
			var used = countAPsOnRadio(r.name);
			var safeTotal = lim.max_total - SAFE_MARGIN;
			var riskClass = used >= lim.max_total
				? 'alert-message error'
				: (used >= safeTotal ? 'alert-message warning' : 'alert-message');

			limitRows.push(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, lim.label),
				E('td', { 'class': 'td' }, r.name),
				E('td', { 'class': 'td' }, String(lim.max_total)),
				E('td', { 'class': 'td' }, String(safeTotal)),
				E('td', { 'class': 'td' }, String(used)),
				E('td', { 'class': 'td' }, [
					E('span', {
						'class': used >= lim.max_total ? 'ifacebadge' : 'ifacebadge',
						'style': 'background:' + (used >= lim.max_total ? '#d9534f' : (used >= safeTotal ? '#f0ad4e' : '#5cb85c')) + ';color:#fff;padding:2px 8px;border-radius:3px;'
					}, used >= lim.max_total ? _('已达上限') : (used >= safeTotal ? _('接近上限') : _('正常')))
				])
			]));
		});

		var limitTable = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('硬件能力与风险提示')),
			E('table', { 'class': 'table' }, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, _('频段')),
					E('th', { 'class': 'th' }, _('设备')),
					E('th', { 'class': 'th' }, _('理论上限')),
					E('th', { 'class': 'th' }, _('建议上限')),
					E('th', { 'class': 'th' }, _('当前已用')),
					E('th', { 'class': 'th' }, _('状态'))
				])
			].concat(limitRows)),
			E('div', { 'class': 'alert-message warning' }, [
				E('strong', {}, _('⚠ 重要提醒：')),
				E('br'),
				_('本机 MT7981 无线驱动对每个频段的 AP 数量有硬限制。'),
				E('br'),
				E('strong', {}, _('2.4G 超过 15 个、5G 超过 16 个，会导致整个频段崩溃 —— ')),
				_('不只是多出来的那个失败，连主 SSID 也会一起掉线，必须重启 WiFi 才能恢复。'),
				E('br'),
				_('建议保留 2 个余量，即 2.4G 最多 13 个、5G 最多 14 个（含主 SSID）。')
			])
		]);

		/* ---- 批量生成表单 ---- */
		var genForm = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('批量生成')),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('目标频段')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('select', { 'id': 'mw-radio', 'class': 'cbi-input-select' },
						radios.map(function(r) {
							var lim = getBandLimit(r);
							return E('option', { 'value': r.name }, [
								lim.label + ' (' + r.name + ') — ' +
								_('可用 ') + (lim.max_total - countAPsOnRadio(r.name)) + _(' 个')
							]);
						})
					)
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('创建数量')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('input', {
						'id': 'mw-count',
						'class': 'cbi-input-text',
						'type': 'number',
						'min': '1',
						'max': '30',
						'value': '2',
						'style': 'width:100px'
					}),
					E('div', { 'class': 'cbi-value-description' },
						_('要新增多少个 SSID（不含现有主 SSID）'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('网络模式')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('select', { 'id': 'mw-mode', 'class': 'cbi-input-select' }, [
						E('option', { 'value': 'lan' }, _('并入主网络 — 同主网段，设备之间互通')),
						E('option', { 'value': 'iso' }, _('隔离模式 — 每个 SSID 独立网段，互相不可见，仅能上网'))
					]),
					E('div', { 'id': 'mw-mode-desc', 'class': 'cbi-value-description' },
						_('并入主网络：所有设备在同一局域网，可互访（适合多区域覆盖）。'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('SSID 前缀')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('input', {
						'id': 'mw-prefix',
						'class': 'cbi-input-text',
						'type': 'text',
						'value': 'Firekb',
						'style': 'width:200px'
					}),
					E('div', { 'class': 'cbi-value-description' },
						_('生成的 SSID 形如 Firekb-1、Firekb-2 …'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('统一密码')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('input', {
						'id': 'mw-key',
						'class': 'cbi-input-text',
						'type': 'text',
						'value': '12345678',
						'style': 'width:200px'
					}),
					E('div', { 'class': 'cbi-value-description' },
						_('至少 8 位。生成后可在下方列表逐个修改。'))
				])
			]),
			E('div', { 'id': 'mw-warn', 'style': 'margin:10px 0' }),
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', {
					'id': 'mw-generate-btn',
					'class': 'btn cbi-button cbi-button-action important',
					'click': ui.createHandlerFn(this, function() {
						return self.handleGenerate(radios);
					})
				}, _('生成 SSID'))
			])
		]);

		/* 数量输入时实时提示风险 */
		setTimeout(function() {
			var cntEl = document.getElementById('mw-count');
			var radEl = document.getElementById('mw-radio');
			if (!cntEl || !radEl) return;
			function updateWarn() {
				var radioName = radEl.value;
				var radio = radios.filter(function(r) { return r.name == radioName; })[0];
				if (!radio) return;
				var lim = getBandLimit(radio);
				var want = parseInt(cntEl.value || '0', 10);
				var current = countAPsOnRadio(radioName);
				var after = current + want;
				var box = document.getElementById('mw-warn');
				if (!box) return;

				if (want < 1) {
					box.innerHTML = '';
					return;
				}
				if (after > lim.max_total) {
					box.innerHTML = '<div class="alert-message error">' +
						'<strong>⛔ 危险：</strong>' + lim.label + ' 将会有 <strong>' + after +
						'</strong> 个 AP，超过硬件上限 <strong>' + lim.max_total +
						'</strong>。整个频段会崩溃，主 SSID 也会掉线。<br>' +
						'请把数量降到 ' + Math.max(0, lim.max_total - current) + ' 或更少。</div>';
				}
				else if (after >= lim.max_total - SAFE_MARGIN + 1) {
					box.innerHTML = '<div class="alert-message warning">' +
						'<strong>⚠ 风险：</strong>' + lim.label + ' 将达到 <strong>' + after +
						'</strong> 个 AP（建议上限 ' + (lim.max_total - SAFE_MARGIN) +
						'）。贴近上限时可能因启动时序不同而偶发失败，建议留出余量。</div>';
				}
				else {
					box.innerHTML = '<div class="alert-message">' +
						'✓ ' + lim.label + ' 将达到 <strong>' + after + '</strong> 个 AP，' +
						'在安全范围内（上限 ' + lim.max_total + '）。</div>';
				}
			}
			cntEl.addEventListener('input', updateWarn);
			cntEl.addEventListener('change', updateWarn);
			radEl.addEventListener('change', updateWarn);
			updateWarn();

			/* 模式切换时更新说明 */
			var modeEl = document.getElementById('mw-mode');
			if (modeEl) {
				modeEl.addEventListener('change', function() {
					var d = document.getElementById('mw-mode-desc');
					if (!d) return;
					if (modeEl.value == 'iso')
						d.innerHTML = _('隔离模式：每个 SSID 分配独立网段（192.168.11.x、192.168.12.x …），' +
							'彼此不可访问，也不能访问主网络，但可以正常上网。' +
							'适合访客网络、IoT 设备隔离。');
					else
						d.innerHTML = _('并入主网络：所有设备在同一局域网，可互访（适合多区域覆盖）。');
				});
			}
		}, 100);

		/* ---- 已创建的 SSID 列表 ---- */
		var listSection = this.renderList(radios);

		/* Vantage 主题底部有固定导航栏，矮窗口下会遮挡页面末尾的按钮。
		   给 body 加底部内边距，确保所有操作按钮可点击。 */
		setTimeout(function() {
			if (!document.body.classList.contains('mw-padded')) {
				document.body.classList.add('mw-padded');
				document.body.style.paddingBottom = '160px';
			}
		}, 50);

		/* 页面渲染后自动跑一次环境自检 */
		window.setTimeout(function() { self.runCheck(true); }, 300);

		return E('div', {}, [
			overview,
			limitTable,
			genForm,
			listSection,
			E('div', { 'style': 'height:120px' })
		]);
	},

	/* 环境自检：调用 mwcheck -j，渲染状态条与详情 */
	runCheck: function(silent) {
		var self = this;
		var box = document.getElementById('mw-health');
		var txt = document.getElementById('mw-health-text');
		var det = document.getElementById('mw-health-detail');
		var tog = document.getElementById('mw-health-toggle');
		if (!box || !txt) return Promise.resolve();

		if (!silent)
			txt.textContent = _('正在检测环境…');

		return fs.exec('/usr/sbin/mwcheck', [ '-j' ]).then(function(res) {
			var raw = (res.stdout || '').trim();
			if (!raw)
				throw new Error((res.stderr || '').trim() || _('自检脚本无输出'));

			/* 取出最后一行 JSON（防止 stderr 混入） */
			var lines = raw.split('\n');
			var json = null;
			for (var i = lines.length - 1; i >= 0; i--) {
				var l = lines[i].trim();
				if (l.charAt(0) == '{') { json = l; break; }
			}
			if (!json) throw new Error(_('无法解析自检结果'));

			var d = JSON.parse(json);
			self._checkVerdict = d.verdict;
			var color, bg, icon;
			if (d.verdict == 'fail') {
				color = '#c9302c'; bg = '#fdf2f2'; icon = '✗';
			} else if (d.verdict == 'warn') {
				color = '#c8960c'; bg = '#fdfaef'; icon = '!';
			} else {
				color = '#3c763d'; bg = '#f2f8f2'; icon = '✓';
			}

			box.style.borderLeftColor = color;
			box.style.background = bg;

			var sys = d.system || {};
			var parts = [];
			parts.push(icon + ' ' + d.message);
			if (sys.release)
				parts.push(_('系统') + ' ' + sys.release + ' / ' + (sys.pkgmgr || ''));
			if (sys.model)
				parts.push(sys.model);
			txt.textContent = parts.join('  ·  ');
			txt.style.color = color;
			txt.style.fontWeight = 'bold';

			/* 详情列表 */
			if (det) {
				var html = '';
				var cur = '';
				(d.items || []).forEach(function(it) {
					if (it.section != cur) {
						if (cur) html += '</div>';
						html += '<div style="margin-bottom:8px">' +
							'<div style="font-weight:bold;color:#555;margin-bottom:3px">' +
							esc(it.section) + '</div>';
						cur = it.section;
					}
					var c = it.level == 'fail' ? '#c9302c'
					      : it.level == 'warn' ? '#c8960c' : '#3c763d';
					var mark = it.level == 'fail' ? '✗'
					         : it.level == 'warn' ? '!' : '✓';
					html += '<div style="color:' + c + ';padding:1px 0">' +
						mark + ' ' + esc(it.message) + '</div>';
				});
				if (cur) html += '</div>';
				det.innerHTML = html;
			}
			if (tog) tog.style.display = 'inline-block';

			/* 有阻碍项时禁用「生成 SSID」并说明原因 */
			var genBtn = document.getElementById('mw-generate-btn');
			if (genBtn) {
				if (d.verdict == 'fail') {
					genBtn.disabled = true;
					genBtn.style.opacity = '0.5';
					genBtn.style.cursor = 'not-allowed';
					genBtn.title = _('环境检测未通过，请先解决上方红色问题项');
					var tip = document.getElementById('mw-block-tip');
					if (!tip) {
						tip = E('div', {
							'id': 'mw-block-tip',
							'style': 'margin:8px 0;padding:8px 12px;border-radius:3px;' +
								'background:#fdf2f2;border-left:4px solid #c9302c;color:#c9302c;font-size:13px'
						});
						genBtn.parentNode.parentNode.insertBefore(tip, genBtn.parentNode);
					}
					tip.textContent = '✗ ' + _('环境检测未通过，暂时无法创建 SSID。请展开上方详情查看红色问题项。');
					tip.style.display = 'block';
				} else {
					genBtn.disabled = false;
					genBtn.style.opacity = '';
					genBtn.style.cursor = '';
					genBtn.title = '';
					var tip2 = document.getElementById('mw-block-tip');
					if (tip2) tip2.style.display = 'none';
				}
			}
		}).catch(function(e) {
			box.style.borderLeftColor = '#999';
			box.style.background = '#f5f5f5';
			txt.style.color = '#999';
			txt.style.fontWeight = 'normal';
			txt.textContent = _('自检不可用：') + e.message;
		});

		function esc(s) {
			return String(s).replace(/&/g, '&amp;')
				.replace(/</g, '&lt;').replace(/>/g, '&gt;');
		}
	},

	/* 渲染已创建的 SSID 列表（可编辑名称/密码/启用状态/删除） */
	renderList: function(radios) {
		var self = this;
		var items = [];

		uci.sections('wireless', 'wifi-iface', function(s) {
			if (s.mw_managed != '1')
				return;
			items.push(s);
		});

		var head = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('已创建的 WiFi') + ' (' + items.length + ')')
		]);

		/* 孤儿网段清理入口：始终显示，即使列表为空也可能有残留 */
		head.appendChild(E('div', { 'style': 'margin:8px 0' }, [
			E('button', {
				'class': 'btn cbi-button',
				'click': ui.createHandlerFn(self, function() {
					return self.handleCleanupOrphans();
				})
			}, _('清理残留网段')),
			E('span', {
				'class': 'cbi-value-description',
				'style': 'margin-left:10px'
			}, _('扫描并删除已无对应 SSID 的隔离网段（network/dhcp/firewall）'))
		]));

		if (items.length == 0) {
			head.appendChild(E('p', { 'class': 'cbi-section-descr' },
				_('还没有通过本插件创建的 WiFi。用上方「批量生成」来创建。')));
			return head;
		}

		/* 异步刷新在线设备数：先渲染占位，数据回来后填充；之后每 15 秒自动刷新 */
		window.setTimeout(function() { self.refreshClients(radios); }, 200);
		if (self._clientTimer) { clearInterval(self._clientTimer); }
		self._clientTimer = setInterval(function() {
			if (!document.querySelector('td.mw-client-cell')) {
				clearInterval(self._clientTimer);
				self._clientTimer = null;
				return;
			}
			self.refreshClients(radios);
		}, 15000);

		var rows = [];
		var titles = E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, _('启用')),
			E('th', { 'class': 'th' }, _('频段')),
			E('th', { 'class': 'th' }, _('SSID')),
			E('th', { 'class': 'th' }, _('网段')),
			E('th', { 'class': 'th' }, _('在线设备')),
			E('th', { 'class': 'th' }, _('密码')),
			E('th', { 'class': 'th' }, _('操作'))
		]);

		items.forEach(function(s) {
			var radio = radios.filter(function(r) { return r.name == s.device; })[0];
			var lim = radio ? getBandLimit(radio) : { label: '?' };

			/* 网段显示：lan 模式显示主网络实际网段，隔离模式从接口里读实际 IP */
			var netLabel;
			if (s.mw_iso == '1' && s.network) {
				var ip = uci.get('network', s.network, 'ipaddr');
				if (ip)
					netLabel = E('span', { 'style': 'color:#337ab7;font-weight:bold' },
						ip.replace(/\.1$/, '.x'));
				else
					netLabel = s.network;
			}
			else {
				var lanIp = uci.get('network', 'lan', 'ipaddr') || '192.168.1.1';
				netLabel = E('span', { 'title': _('与主网络同网段') },
					lanIp.replace(/\.1$/, '.x'));
			}

			rows.push(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [
					E('input', {
						'type': 'checkbox',
						'checked': s.disabled != '1' ? 'checked' : null,
						'change': ui.createHandlerFn(self, function(ev) {
							uci.set('wireless', s['.name'], 'disabled', ev.target.checked ? '0' : '1');
							uci.save();
							uci.apply();
							self.reloadWifi();
						})
					})
				]),
				E('td', { 'class': 'td' }, lim.label),
				E('td', { 'class': 'td' }, [
					E('input', {
						'type': 'text',
						'class': 'cbi-input-text',
						'value': s.ssid || '',
						'style': 'width:170px',
						'change': ui.createHandlerFn(self, function(ev) {
							uci.set('wireless', s['.name'], 'ssid', ev.target.value);
							uci.save();
							uci.apply();
						})
					})
				]),
				E('td', { 'class': 'td' }, netLabel),
				E('td', {
					'class': 'td mw-client-cell',
					'data-ssid': s.ssid || '',
					'data-device': s.device || ''
				}, [
					E('span', { 'class': 'mw-client-count', 'style': 'color:#999' }, '—')
				]),
				E('td', { 'class': 'td' }, [
					E('input', {
						'type': 'text',
						'class': 'cbi-input-text',
						'value': s.key || '',
						'style': 'width:140px',
						'change': ui.createHandlerFn(self, function(ev) {
							uci.set('wireless', s['.name'], 'key', ev.target.value);
							uci.save();
							uci.apply();
						})
					})
				]),
				E('td', { 'class': 'td' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-remove',
						'click': ui.createHandlerFn(self, function() {
							return self.handleDelete(s['.name']);
						})
					}, _('删除'))
				])
			]));
		});

		head.appendChild(E('table', { 'class': 'table' }, [ titles ].concat(rows)));

		head.appendChild(E('p', { 'class': 'cbi-section-descr' },
			_('提示：修改 WiFi 名称或密码后会自动保存。')));

		return head;
	},

	/* ---- 生成操作 ---- */
	/* 异步拉取各 SSID 的在线设备数并填充表格 */
	refreshClients: function(radios) {
		var self = this;

		function fill(map) {			var cells = document.querySelectorAll('td.mw-client-cell');
			for (var i = 0; i < cells.length; i++) {
				var cell = cells[i];
				var ssid = cell.getAttribute('data-ssid') || '';
				var dev = cell.getAttribute('data-device') || '';
				var slot = cell.querySelector('.mw-client-count');
				if (!slot) continue;

				/* 按 ifname 匹配优先，回退到 SSID 匹配（同频段可能有重名，取已用的） */
				var entry = null;
				if (map[dev]) entry = map[dev];
				if (!entry) {
					for (var k in map) {
						if (map[k].ssid == ssid) { entry = map[k]; break; }
					}
				}
				if (!entry) {
					slot.textContent = '—';
					slot.style.color = '#999';
					continue;
				}

				var n = entry.count || 0;
				slot.textContent = n + ' ' + _('台');
				slot.style.color = (n > 0) ? '#2e7d32' : '#999';
				slot.style.fontWeight = (n > 0) ? 'bold' : 'normal';

				/* 悬浮显示每个客户端的 MAC / 信号 */
				var tip = '';
				(entry.clients || []).forEach(function(c) {
					tip += c.mac + '  ' + (c.signal || '') + '  RX:' + (c.rx || '-') + '  TX:' + (c.tx || '-') + '\n';
				});
				cell.title = tip || _('暂无设备连接');
			}
		}

		return fs.exec('/usr/sbin/mwclients', [ '-p' ]).then(function(res) {
			var txt = (res && res.stdout) ? res.stdout.trim() : '';
			if (!txt) { fill({}); return; }
			/* 后端可能返回数组形式，兼容一下 */
			if (Array.isArray(txt)) txt = txt.join('');
			try {
				fill(JSON.parse(txt));
			} catch (e) {
				console.warn('mwclients parse failed:', e, txt);
				fill({});
			}
		}).catch(function() { fill({}); });
	},

	/* 清理孤儿网段：先 dry-run 列出，确认后执行 */
	handleCleanupOrphans: function() {
		var self = this;
		return fs.exec('/usr/sbin/mwctl', [ 'cleanup-orphans', '-n' ]).then(function(res) {
			var out = (res.stdout || '').trim();
			var err = (res.stderr || '').trim();
			var m = /would_remove=(\d+)/.exec(out);
			var cnt = m ? parseInt(m[1], 10) : 0;

			if (cnt == 0) {
				ui.addNotification(null, E('p', _('没有发现残留网段，配置是干净的。')), 'info');
				return;
			}

			/* 从 stderr 里提取"孤儿 mwX"明细 */
			var detail = [];
			(err || out).split('\n').forEach(function(l) {
				l = l.trim();
				if (l.indexOf(_('孤儿')) === 0 || /^孤儿 mw\d+/.test(l))
					detail.push(E('li', {}, l));
			});

			return new Promise(function(resolve) {
				ui.showModal(_('发现残留网段'), [
					E('p', {}, [
						_('检测到 ') + E('strong', {}, String(cnt)) +
						_(' 个已无对应 SSID 的隔离网段，删除后会释放这些网段和防火墙规则。')
					]),
					detail.length ? E('ul', { 'style': 'max-height:200px;overflow:auto;font-size:12px' }, detail) : '',
					E('div', { 'class': 'right' }, [
						E('button', { 'class': 'btn', 'click': ui.hideModal }, _('取消')),
						' ',
						E('button', {
							'class': 'btn cbi-button cbi-button-remove',
							'click': ui.createHandlerFn(self, function() {
								ui.hideModal();
								return fs.exec('/usr/sbin/mwctl', [ 'cleanup-orphans' ])
									.then(function(r2) {
										var o2 = (r2.stdout || '').trim();
										var n2 = /orphans_removed=(\d+)/.exec(o2);
										ui.addNotification(null, E('p',
											_('已清理 ') + (n2 ? n2[1] : '?') + _(' 个残留网段。')), 'info');
										window.setTimeout(function() { location.reload(); }, 1500);
									}).catch(function(e2) {
										ui.addNotification(null, E('p', _('清理失败：') + e2), 'error');
									});
							})
						}, _('确认清理'))
					])
				]);
				resolve();
			});
		}).catch(function(e) {
			ui.addNotification(null, E('p', _('扫描失败：') + e), 'error');
		});
	},

	handleGenerate: function(radios) {
		var self = this;

		/* 环境自检有阻碍项时禁止创建 */
		if (this._checkVerdict == 'fail') {
			ui.addNotification(null, E('p',
				_('环境检测未通过，请先解决上方红色问题项')), 'error');
			return;
		}

		var radioName = document.getElementById('mw-radio').value;
		var cnt = parseInt(document.getElementById('mw-count').value || '0', 10);
		var prefix = document.getElementById('mw-prefix').value || 'Firekb';
		var key = document.getElementById('mw-key').value || '';

		var radio = radios.filter(function(r) { return r.name == radioName; })[0];
		if (!radio) {
			ui.addNotification(null, E('p', _('请选择频段')), 'error');
			return;
		}
		if (cnt < 1 || cnt > 30) {
			ui.addNotification(null, E('p', _('数量必须是 1~30 之间')), 'error');
			return;
		}
		if (key.length > 0 && key.length < 8) {
			ui.addNotification(null, E('p', _('密码至少 8 位，或留空表示开放网络')), 'error');
			return;
		}

		var lim = getBandLimit(radio);
		var current = countAPsOnRadio(radioName);
		var after = current + cnt;

		/* 硬性拦截 */
		if (after > lim.max_total) {
			return this.confirmDanger(radio, lim, current, cnt, after, prefix, key);
		}
		/* 接近上限：警告但可继续 */
		if (after >= lim.max_total - SAFE_MARGIN + 1) {
			return this.confirmRisk(radio, lim, current, cnt, after, prefix, key);
		}
		return this.doGenerate(radio, cnt, prefix, key);
	},

	confirmDanger: function(radio, lim, current, cnt, after, prefix, key) {
		var self = this;
		return new Promise(function(resolve) {
			ui.showModal(_('⛔ 超过硬件上限'), [
				E('p', {}, [
					E('strong', {}, _('你正在为 ' + lim.label + ' 创建过多 AP。')),
					E('br'), E('br'),
					_('当前已有 ') + current + _(' 个 AP，再加 ') + cnt +
					_(' 个将变成 ') + E('strong', {}, String(after)) + _(' 个。'),
					E('br'),
					_('该频段的硬件上限是 ') + E('strong', {}, String(lim.max_total)) + _(' 个。'),
					E('br'), E('br'),
					E('strong', { 'style': 'color:#d9534f' }, [
						_('超过上限会导致整个频段的 hostapd 崩溃 —— 所有 SSID（包括主 SSID）全部掉线，' +
						  '必须重启无线才能恢复。')
					]),
					E('br'), E('br'),
					_('建议数量：') + Math.max(0, lim.max_total - current) + _(' 个以内。')
				]),
				E('div', { 'class': 'right' }, [
					E('button', {
						'class': 'btn',
						'click': ui.hideModal
					}, _('取消（推荐）')),
					' ',
					E('button', {
						'class': 'btn cbi-button cbi-button-reset',
						'click': ui.createHandlerFn(self, function() {
							ui.hideModal();
							return self.doGenerate(radio, cnt, prefix, key, true);
						})
					}, _('我坚持要试'))
				])
			]);
			resolve();
		});
	},

	confirmRisk: function(radio, lim, current, cnt, after, prefix, key) {
		var self = this;
		return new Promise(function(resolve) {
			ui.showModal(_('⚠ 接近硬件上限'), [
				E('p', {}, [
					lim.label + _(' 将达到 ') + E('strong', {}, String(after)) +
					_(' 个 AP，接近硬件上限 ') + String(lim.max_total) + _('。'),
					E('br'), E('br'),
					_('在极限附近，可能因为启动时序的细微差异导致部分 SSID 创建失败。' +
					  '建议保留 2 个余量。'),
				]),
				E('div', { 'class': 'right' }, [
					E('button', { 'class': 'btn', 'click': ui.hideModal }, _('取消')),
					' ',
					E('button', {
						'class': 'btn cbi-button cbi-button-apply',
						'click': ui.createHandlerFn(self, function() {
							ui.hideModal();
							return self.doGenerate(radio, cnt, prefix, key);
						})
					}, _('继续'))
				])
			]);
			resolve();
		});
	},

	/* 真正创建 section —— 交给后端 mwctl 处理（隔离模式要建网络/防火墙） */
	doGenerate: function(radio, cnt, prefix, key, force) {
		var self = this;
		var lim = getBandLimit(radio);
		var current = countAPsOnRadio(radio.name);
		var after = current + cnt;

		if (after > lim.max_total && !force) {
			ui.addNotification(null, E('p', _('已取消：超过硬件上限')), 'error');
			return;
		}

		var modeEl = document.getElementById('mw-mode');
		var mode = (modeEl && modeEl.value == 'iso') ? 'iso' : 'lan';

		ui.addNotification(null, E('p',
			_('正在创建 ') + cnt + _(' 个 SSID') +
			(mode == 'iso' ? _('（隔离模式，需要重建网络配置，约需 20 秒）') : '')), 'info');

		return fs.exec('/usr/sbin/mwctl',
			[ 'generate', radio.name, String(cnt), prefix, key, mode ])
			.then(function(res) {
				var out = (res.stdout || '').trim();
				var err = (res.stderr || '').trim();
				if (res.code != 0) {
					ui.addNotification(null, E('p',
						_('创建失败：') + (err || out || ('code ' + res.code))), 'error');
					return;
				}
				return self.reloadWifi().then(function() {
					window.setTimeout(function() { location.reload(); }, 1500);
				});
			})
			.catch(function(e) {
				ui.addNotification(null, E('p', _('执行失败：') + e), 'error');
			});
	},

	/* 删除单个 —— 走 mwctl，隔离模式会一并回收网段/防火墙 */
	handleDelete: function(secName) {
		var self = this;
		return new Promise(function(resolve) {
			ui.showModal(_('确认删除'), [
				E('p', {}, _('确定删除 ') + secName + _(' 这个 SSID 吗？')),
				E('div', { 'class': 'right' }, [
					E('button', { 'class': 'btn', 'click': ui.hideModal }, _('取消')),
					' ',
					E('button', {
						'class': 'btn cbi-button cbi-button-remove',
						'click': ui.createHandlerFn(self, function() {
							ui.hideModal();
							return fs.exec('/usr/sbin/mwctl', [ 'delete', secName ])
								.then(function(res) {
									if (res.code != 0) {
										ui.addNotification(null, E('p',
											_('删除失败：') + (res.stderr || res.stdout)), 'error');
										return;
									}
									return self.reloadWifi().then(function() {
										window.setTimeout(function() { location.reload(); }, 1500);
									});
								})
								.catch(function(e) {
									ui.addNotification(null, E('p', _('执行失败：') + e), 'error');
								});
						})
					}, _('删除'))
				])
			]);
			resolve();
		});
	},

	/* 全部应用 */
	handleApplyAll: function() {
		var self = this;
		uci.save();
		uci.apply();
		ui.addNotification(null, E('p', _('配置已保存，正在重启无线…')), 'info');
		return this.reloadWifi().then(function() {
			window.setTimeout(function() { location.reload(); }, 2000);
		});
	},

	reloadWifi: function() {
		var self = this;
		/* network.wireless 没有 reload 方法；用 `wifi reload` 命令，
		   它能正确处理新增/删除 SSID 的整个重建流程。
		   隔离模式下新建的网桥需要 firewall 重新加载才能被 fw4 接管，
		   否则运行态 nftables 里没有对应 zone 跳转（接口会落入默认策略）。 */
		return fs.exec('/sbin/wifi', [ 'reload' ]).then(function(res) {
			if (res.code != 0)
				ui.addNotification(null, E('p',
					_('无线重载返回错误码 ') + res.code), 'warning');
			/* network 重载让新网桥/静态地址就绪 */
			return fs.exec('/etc/init.d/network', [ 'reload' ]).catch(function() {});
		}).then(function() {
			/* 关键：fw4 必须重新生成规则集，才会把 br-mwbrN 绑定到对应 zone */
			return fs.exec('/etc/init.d/firewall', [ 'reload' ]).catch(function(err) {
				ui.addNotification(null, E('p',
					_('防火墙重载失败：') + err), 'warning');
			});
		}).then(function() {
			/* 无线重建需要时间（多个 VAP 时更久） */
			return new Promise(function(r) { window.setTimeout(r, 10000); });
		}).catch(function(err) {
			ui.addNotification(null, E('p',
				_('无线重载失败：') + err), 'error');
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
