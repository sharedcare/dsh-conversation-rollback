window.__ModuleLoader__.load({
	id: "conversation-rollback",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		let React = require("react");
		const inject = ["slots", "sessions"];
		const ROLLBACK_CSS = `
			.dsh-rollback-turn-actions {
				display: inline-flex;
				align-items: flex-start;
				gap: 8px;
				flex-wrap: wrap;
				padding: 2px 0;
			}
			.dsh-rollback-tail {
				display: inline-flex;
				align-items: center;
				gap: 4px;
				border: none;
				background: transparent;
				color: inherit;
				opacity: 0.55;
				font-size: 12px;
				line-height: 1;
				padding: 4px 8px;
				border-radius: 6px;
				cursor: pointer;
				transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
			}
			.dsh-rollback-tail:hover:not(:disabled) {
				opacity: 1;
				background: rgba(128, 128, 128, 0.14);
			}
			.dsh-rollback-tail:disabled {
				cursor: default;
				opacity: 0.4;
			}
			.dsh-rollback-tail-armed {
				opacity: 1;
				color: rgb(224, 92, 82);
				background: rgba(224, 92, 82, 0.12);
			}
			.dsh-rollback-edit {
				display: flex;
				flex-direction: column;
				gap: 8px;
				width: min(720px, 100%);
				padding: 10px;
				border: 1px solid rgba(128, 128, 128, 0.28);
				border-radius: 12px;
				background: rgba(128, 128, 128, 0.08);
			}
			.dsh-rollback-edit-input {
				width: 100%;
				min-height: 72px;
				max-height: 320px;
				resize: vertical;
				border: 1px solid rgba(128, 128, 128, 0.28);
				border-radius: 8px;
				background: rgba(0, 0, 0, 0.04);
				color: inherit;
				font: inherit;
				line-height: 1.5;
				padding: 8px 10px;
				box-sizing: border-box;
			}
			.dsh-rollback-edit-input:focus {
				outline: none;
				border-color: rgba(80, 140, 255, 0.7);
			}
			.dsh-rollback-edit-actions {
				display: flex;
				align-items: center;
				justify-content: flex-end;
				gap: 8px;
			}
			.dsh-rollback-edit-cancel,
			.dsh-rollback-edit-save {
				border: none;
				border-radius: 8px;
				padding: 5px 12px;
				font-size: 12px;
				line-height: 1.4;
				cursor: pointer;
			}
			.dsh-rollback-edit-cancel {
				background: rgba(128, 128, 128, 0.16);
				color: inherit;
			}
			.dsh-rollback-edit-save {
				background: rgba(70, 130, 255, 0.9);
				color: #fff;
			}
			.dsh-rollback-edit-cancel:disabled,
			.dsh-rollback-edit-save:disabled {
				cursor: default;
				opacity: 0.55;
			}
			.dsh-rollback-notice {
				color: rgb(224, 92, 82);
				font-size: 12px;
				line-height: 1.4;
			}
			.dsh-rollback-action {
				width: 28px;
				height: 28px;
				border: none;
				border-radius: 28px;
				background: transparent;
				color: var(--dsw-alias-label-tertiary, rgba(128, 128, 128, 0.7));
				cursor: pointer;
				display: inline-flex;
				align-items: center;
				justify-content: center;
				padding: 0;
				font-size: 14px;
				line-height: 1;
				transition: background 120ms ease, color 120ms ease, opacity 120ms ease;
			}
			.dsh-rollback-action:hover:not(:disabled) {
				background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.14));
				color: var(--dsw-alias-label-secondary, inherit);
			}
			.dsh-rollback-action:disabled {
				cursor: default;
				opacity: 0.4;
			}
			.dsh-rollback-action-armed {
				color: rgb(224, 92, 82);
				background: rgba(224, 92, 82, 0.12);
			}
			.dsh-rollback-edit-overlay {
				position: fixed;
				inset: 0;
				z-index: 1000;
				display: flex;
				align-items: flex-start;
				justify-content: center;
				padding: 10vh 16px 16px;
				background: rgba(0, 0, 0, 0.35);
			}
			.dsh-rollback-edit-dialog {
				display: flex;
				flex-direction: column;
				gap: 8px;
				width: min(720px, 100%);
				padding: 10px;
				border: 1px solid rgba(128, 128, 128, 0.28);
				border-radius: 12px;
				background: var(--dsw-alias-bg-base, #fff);
				box-shadow: 0 12px 40px rgba(0, 0, 0, 0.24);
			}
		`;
		/**
		 * Read the Chat target snapshot inside a slot entry. DSH 0.1.2-rc.1 exposes
		 * the Chat target as the session-scope `chat` hook (`useChat`) rather than a
		 * `chat` field on the session snapshot, so prefer the hook and keep the
		 * legacy shape as a fallback for older builds (one bundle spans both).
		 */
		function chatSelector(props, select) {
			if (typeof props.useChat === "function") return props.useChat(select);
			return props.useSession((snapshot) => select(snapshot && snapshot.chat));
		}
		function userTextForTurn(chat, turnNumber) {
			if (turnNumber === null) return null;
			if (!chat || !chat.locations || !chat.nodes) return null;
			const keys = chat.locations.getTurn(turnNumber);
			let found = false;
			const parts = [];
			for (const key of keys) {
				const node = chat.nodes.get(key);
				if (!node || (node.kind !== "user" && node.kind !== "steering")) continue;
				const content = node.data && Array.isArray(node.data.content) ? node.data.content : null;
				if (!content) continue;
				for (const block of content) {
					if (block && block.type === "text" && typeof block.text === "string") {
						found = true;
						parts.push(block.text);
					}
				}
			}
			return found ? parts.join("\n") : null;
		}
		function turnHasImage(chat, turnNumber) {
			if (turnNumber === null) return false;
			if (!chat || !chat.locations || !chat.nodes) return false;
			for (const key of chat.locations.getTurn(turnNumber)) {
				const node = chat.nodes.get(key);
				if (!node || (node.kind !== "user" && node.kind !== "steering")) continue;
				const content = node.data && Array.isArray(node.data.content) ? node.data.content : null;
				if (!content) continue;
				for (const block of content) {
					if (block && block.type === "image") return true;
				}
			}
			return false;
		}
		function finalAssistantFact(chat, messageId, fact) {
			if (!messageId) return null;
			if (!chat || !chat.order || !chat.nodes) return null;
			for (const key of chat.order) {
				const node = chat.nodes.get(key);
				if (!node) continue;
				const finalNode = node.data && node.data.finalNode;
				if (!finalNode || finalNode.messageId !== messageId) continue;
				const location = node.location;
				const turn = location && (location.kind === "turn" || location.kind === "step") ? location.turn.turn : null;
				if (fact === "turn") return turn;
				if (fact === "seq") return Number.isSafeInteger(finalNode.seq) ? finalNode.seq : null;
			}
			return null;
		}
		function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === undefined) return;
			const timer = ctx.get("timer");
			const sessions = ctx.get("sessions");
			const styleEl = document.createElement("style");
			// FORK DEVIATION (see README "本 fork 的改动"): dsh-client-hmr reclaims
			// only style[data-plugin="<loader entry name>"] on a hot swap, so an
			// unmarked tag leaves stale CSS behind on every rebuild.
			styleEl.setAttribute("data-plugin", "conversation-rollback");
			styleEl.setAttribute("data-plugin-css", "conversation-rollback/rollback.css");
			styleEl.textContent = ROLLBACK_CSS;
			document.head.appendChild(styleEl);
			ctx.effect(() => () => { styleEl.remove(); }, "conversation-rollback: styles");

			/**
			 * Refetch the session window without a full page reload. `repairGap`
			 * keeps the current UI mounted and replaces the window when the Host
			 * returns fresh history; `resync` is the heavier fallback.
			 */
			async function refreshSessionView(sessionId) {
				try {
					const binding = sessions && typeof sessions.binding === "function" ? sessions.binding(sessionId) : undefined;
					const session = binding && binding.session;
					if (session && typeof session.repairGap === "function" && session.stitching !== true) {
						try {
							await session.repairGap();
							return true;
						} catch (error) {
							console.error("[conversation-rollback] repairGap refresh failed, falling back to resync:", error);
						}
					}
					if (session && typeof session.resync === "function") {
						await session.resync();
						return true;
					}
				} catch (error) {
					console.error("[conversation-rollback] in-place session refresh failed:", error);
				}
				return false;
			}

			async function settleMutation(sessionId) {
				const refreshed = await refreshSessionView(sessionId);
				if (!refreshed && typeof location !== "undefined" && typeof location.reload === "function") {
					location.reload();
				}
				return refreshed;
			}

			async function readJsonResponse(response) {
				try { return await response.json(); } catch { return null; }
			}

			/**
			 * Shadow the built-in `user` Chat renderer at a lower priority. The
			 * original component's returned element is cloned with a wrapped
			 * `actions` callback, so the edit action is injected into the same
			 * MessageIconActions row as Copy — without patching ui-conversation.
			 *
			 * The official renderer is registered by ui-chat *after* this plugin
			 * activates (both wait only on `slots`/`sessions`), so a one-shot lookup
			 * at apply time misses it. Track the slot's entry mutations instead: the
			 * takeover installs as soon as an official renderer is visible, whatever
			 * the activation order.
			 */
			let OriginalUserMessageNodeView;
			let disposeUserTakeover = null;
			function officialUserNodeView() {
				for (const entry of slots.entries("conversation.chat.node")) {
					if (entry.options.key !== "user") continue;
					if (entry.component === UserMessageNodeViewWithActions) continue;
					if (entry.component !== undefined) return entry.component;
				}
				return undefined;
			}
			function hasUserTakeover() {
				return slots.entries("conversation.chat.node").some((entry) => entry.component === UserMessageNodeViewWithActions);
			}
			function reconcileUserTakeover() {
				const original = officialUserNodeView();
				if (original === undefined) return;
				OriginalUserMessageNodeView = original;
				if (hasUserTakeover()) return;
				disposeUserTakeover = slots.register(
					{
						name: "conversation.chat.node",
						key: "user",
						priority: -1,
						locale: "conversation",
						children: {
							"conversation.chat.user-actions": {
								kind: "list",
								scope: "session"
							}
						}
					},
					UserMessageNodeViewWithActions
				);
			}
			function UserMessageNodeViewWithActions(props) {
				const { renderSlot, node } = props;
				const original = OriginalUserMessageNodeView;
				if (original === undefined) return null;
				const InnerUserMessageNodeView = original && original.type ? original.type : original;
				const rendered = typeof InnerUserMessageNodeView === "function" ? InnerUserMessageNodeView(props) : null;
				if (rendered === null || !React.isValidElement(rendered)) {
					return React.createElement(original, props);
				}
				const originalActions = rendered.props.actions;
				const location = node && node.location;
				const turn = location && (location.kind === "turn" || location.kind === "step") ? location.turn.turn : void 0;
				const userActions = typeof renderSlot === "function" ? renderSlot("conversation.chat.user-actions", { node: node && node.data, turn }) : null;
				const actions = typeof originalActions === "function" ? (text) => {
					const row = originalActions(text);
					return React.isValidElement(row) ? React.cloneElement(row, { extraActions: userActions }) : row;
				} : originalActions;
				return React.cloneElement(rendered, { actions });
			}

			function TurnTailActions(props) {
				const turnNumber = props.turn && typeof props.turn.turn === "number" ? props.turn.turn : null;
				const seq = props.seq;
				const [armed, setArmed] = React.useState(false);
				const [busy, setBusy] = React.useState(false);
				const [notice, setNotice] = React.useState(null);
				const [editing, setEditing] = React.useState(false);
				const [draft, setDraft] = React.useState("");
				const isLatest = chatSelector(props, (chat) => {
					if (!chat || turnNumber === null) return true;
					const keys = chat.locations ? chat.locations.getTurn(turnNumber) : [];
					const lastKey = keys.length > 0 ? keys[keys.length - 1] : undefined;
					const order = chat.order;
					if (lastKey === undefined || !order || order.length === 0) return true;
					return order[order.length - 1] === lastKey;
				});
				const editableText = chatSelector(props, (chat) => userTextForTurn(chat, turnNumber));
				const hasImage = chatSelector(props, (chat) => turnHasImage(chat, turnNumber));
				const running = props.useSession((snapshot) => Boolean(snapshot && snapshot.running));
				React.useEffect(() => {
					if (!armed || timer === undefined) return;
					const dispose = timer.timeout(() => setArmed(false), 5000);
					return () => { dispose(); };
				}, [armed]);

				const canRollback = !isLatest && Number.isSafeInteger(seq) && !editing && !running;
				const canEdit = editableText !== null && !hasImage;
				const showDisabledEdit = hasImage;
				if (!canRollback && !canEdit && !showDisabledEdit) return null;

				const beginEdit = () => {
					if (busy || running) return;
					setDraft(editableText ?? "");
					setEditing(true);
					setArmed(false);
					setNotice(null);
				};
				const cancelEdit = () => {
					if (busy) return;
					setEditing(false);
					setNotice(null);
				};
				const runRollback = () => {
					if (busy || editing || running) return;
					if (notice !== null) setNotice(null);
					if (!armed) {
						setArmed(true);
						return;
					}
					setArmed(false);
					setBusy(true);
					fetch("/api/conversation-rollback", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionId: props.sessionId, atSeq: seq })
					}).then(readJsonResponse).then(async (result) => {
						if (result && result.ok) {
							await settleMutation(props.sessionId);
							setBusy(false);
						} else {
							setBusy(false);
							setNotice((result && result.message) || "回退失败");
						}
					}).catch((error) => {
						setBusy(false);
						setNotice("回退失败:" + String(error && error.message || error));
					});
				};
				const runEdit = () => {
					if (busy || running) return;
					const text = draft;
					if (text.trim().length === 0) {
						setNotice("请输入修改后的内容");
						return;
					}
					setBusy(true);
					setNotice(null);
					fetch("/api/conversation-rollback", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							operation: "edit",
							sessionId: props.sessionId,
							turn: turnNumber,
							text
						})
					}).then(readJsonResponse).then(async (result) => {
						if (result && result.ok) {
							await settleMutation(props.sessionId);
							setBusy(false);
						} else {
							setBusy(false);
							setNotice((result && result.message) || "修改失败");
						}
					}).catch((error) => {
						setBusy(false);
						setNotice("修改失败:" + String(error && error.message || error));
					});
				};

				let rollbackLabel = "↩ 回退到此";
				let rollbackTitle = "删除此条之后的所有消息,并在此继续对话(不可撤销)";
				if (busy && !editing) {
					rollbackLabel = "回退中…";
					rollbackTitle = "正在删除后续内容";
				} else if (notice !== null && !editing) {
					rollbackLabel = "⚠ " + notice;
					rollbackTitle = notice;
				} else if (armed) {
					rollbackLabel = "确认回退?将删除其后所有内容";
					rollbackTitle = "再次点击确认:永久删除此条之后的所有消息";
				}
				const rollbackButton = canRollback ? React.createElement("button", {
					className: "dsh-rollback-tail" + (armed ? " dsh-rollback-tail-armed" : ""),
					disabled: busy,
					title: rollbackTitle,
					onClick: runRollback
				}, rollbackLabel) : null;

				const editButton = editing ? null : (canEdit || showDisabledEdit) ? React.createElement("button", {
					className: "dsh-rollback-tail",
					disabled: busy || running || showDisabledEdit,
					title: running ? "会话运行中，请等待本轮结束后再修改" : showDisabledEdit ? "包含图片的输入暂不支持修改" : "修改本轮输入,删除原回复并重新生成(不可撤销)",
					onClick: showDisabledEdit || running ? undefined : beginEdit
				}, "✎ 修改输入") : null;

				const editPanel = editing ? React.createElement("div", {
					className: "dsh-rollback-edit"
				},
					React.createElement("textarea", {
						className: "dsh-rollback-edit-input",
						value: draft,
						rows: Math.min(14, Math.max(3, draft.split("\n").length)),
						autoFocus: true,
						disabled: busy || running,
						placeholder: "修改后按 Cmd/Ctrl+Enter 重新生成",
						onChange: (event) => { setDraft(event.target.value); },
						onKeyDown: (event) => {
							if (event.key === "Escape") {
								event.preventDefault();
								cancelEdit();
							} else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
								event.preventDefault();
								runEdit();
							}
						}
					}),
					React.createElement("div", {
						className: "dsh-rollback-edit-actions"
					},
						notice !== null ? React.createElement("span", { className: "dsh-rollback-notice" }, notice) : null,
						React.createElement("button", {
							className: "dsh-rollback-edit-cancel",
							type: "button",
							disabled: busy || running,
							onClick: cancelEdit
						}, "取消"),
						React.createElement("button", {
							className: "dsh-rollback-edit-save",
							type: "button",
							disabled: busy || running,
							onClick: runEdit
						}, busy ? "提交中…" : "保存并重新生成")
					)
				) : null;

				return React.createElement("div", {
					className: "dsh-rollback-turn-actions"
				}, rollbackButton, editButton, editPanel);
			}

			function contentText(content) {
				if (!Array.isArray(content)) return null;
				let found = false;
				const parts = [];
				for (const block of content) {
					if (block && block.type === "text" && typeof block.text === "string") {
						found = true;
						parts.push(block.text);
					}
				}
				return found ? parts.join("\n") : null;
			}
			function contentHasImage(content) {
				if (!Array.isArray(content)) return false;
				return content.some((block) => block && block.type === "image");
			}

			function UserEditAction(props) {
				const content = props.node && Array.isArray(props.node.content) ? props.node.content : null;
				const text = contentText(content);
				const hasImage = contentHasImage(content);
				const [editing, setEditing] = React.useState(false);
				const [draft, setDraft] = React.useState("");
				const [busy, setBusy] = React.useState(false);
				const [notice, setNotice] = React.useState(null);
				const running = props.useSession((snapshot) => Boolean(snapshot && snapshot.running));
				if (text === null && !hasImage) return null;

				const beginEdit = () => {
					if (busy || running || hasImage) return;
					setDraft(text ?? "");
					setEditing(true);
					setNotice(null);
				};
				const cancelEdit = () => {
					if (busy) return;
					setEditing(false);
					setNotice(null);
				};
				const runEdit = () => {
					if (busy || running) return;
					if (!Number.isSafeInteger(props.turn)) {
						setNotice("无法确定该消息所属回合");
						return;
					}
					if (draft.trim().length === 0) {
						setNotice("请输入修改后的内容");
						return;
					}
					setBusy(true);
					setNotice(null);
					fetch("/api/conversation-rollback", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							operation: "edit",
							sessionId: props.sessionId,
							turn: props.turn,
							text: draft
						})
					}).then(readJsonResponse).then(async (result) => {
						if (result && result.ok) {
							await settleMutation(props.sessionId);
							setEditing(false);
							setBusy(false);
						} else {
							setBusy(false);
							setNotice((result && result.message) || "修改失败");
						}
					}).catch((error) => {
						setBusy(false);
						setNotice("修改失败:" + String(error && error.message || error));
					});
				};

				const editButton = React.createElement("button", {
					className: "dsh-rollback-action",
					type: "button",
					"aria-label": hasImage ? "包含图片的输入暂不支持修改" : "修改输入",
					title: running ? "会话运行中，请等待本轮结束后再修改" : hasImage ? "包含图片的输入暂不支持修改" : "修改这条输入,删除原回复并重新生成(不可撤销)",
					disabled: busy || running || hasImage,
					onClick: hasImage || running ? undefined : beginEdit
				}, "✎");

				const dialog = editing ? React.createElement("div", {
					className: "dsh-rollback-edit-overlay",
					onClick: (event) => {
						if (event.target === event.currentTarget) cancelEdit();
					}
				},
					React.createElement("div", {
						className: "dsh-rollback-edit dsh-rollback-edit-dialog"
					},
						React.createElement("textarea", {
							className: "dsh-rollback-edit-input",
							value: draft,
							rows: Math.min(14, Math.max(3, draft.split("\n").length)),
							autoFocus: true,
							disabled: busy,
							placeholder: "修改后按 Cmd/Ctrl+Enter 重新生成",
							onChange: (event) => { setDraft(event.target.value); },
							onKeyDown: (event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									cancelEdit();
								} else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
									event.preventDefault();
									runEdit();
								}
							}
						}),
						React.createElement("div", {
							className: "dsh-rollback-edit-actions"
						},
							notice !== null ? React.createElement("span", { className: "dsh-rollback-notice" }, notice) : null,
							React.createElement("button", {
								className: "dsh-rollback-edit-cancel",
								type: "button",
								disabled: busy,
								onClick: cancelEdit
							}, "取消"),
							React.createElement("button", {
								className: "dsh-rollback-edit-save",
								type: "button",
								disabled: busy,
								onClick: runEdit
							}, busy ? "提交中…" : "保存并重新生成")
						)
					)
				) : null;

				return React.createElement(React.Fragment, null, editButton, dialog);
			}

			function RollbackAssistantAction(props) {
				const messageId = props.messageId;
				const turnNumber = chatSelector(props, (chat) => finalAssistantFact(chat, messageId, "turn"));
				const seq = chatSelector(props, (chat) => finalAssistantFact(chat, messageId, "seq"));
				const [armed, setArmed] = React.useState(false);
				const [busy, setBusy] = React.useState(false);
				const [notice, setNotice] = React.useState(null);
				const running = props.useSession((snapshot) => Boolean(snapshot && snapshot.running));
				const isLatest = chatSelector(props, (chat) => {
					if (!chat || turnNumber === null) return true;
					const keys = chat.locations ? chat.locations.getTurn(turnNumber) : [];
					const lastKey = keys.length > 0 ? keys[keys.length - 1] : undefined;
					const order = chat.order;
					if (lastKey === undefined || !order || order.length === 0) return true;
					return order[order.length - 1] === lastKey;
				});
				React.useEffect(() => {
					if (!armed || timer === undefined) return;
					const dispose = timer.timeout(() => setArmed(false), 5000);
					return () => { dispose(); };
				}, [armed]);

				if (turnNumber === null || !Number.isSafeInteger(seq) || isLatest) return null;

				const runRollback = () => {
					if (busy || running) return;
					if (notice !== null) setNotice(null);
					if (!armed) {
						setArmed(true);
						return;
					}
					setArmed(false);
					setBusy(true);
					fetch("/api/conversation-rollback", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionId: props.sessionId, atSeq: seq })
					}).then(readJsonResponse).then(async (result) => {
						if (result && result.ok) {
							await settleMutation(props.sessionId);
							setBusy(false);
						} else {
							setBusy(false);
							setNotice((result && result.message) || "回退失败");
						}
					}).catch((error) => {
						setBusy(false);
						setNotice("回退失败:" + String(error && error.message || error));
					});
				};

				let label = armed ? "↩?" : "↩";
				let title = "删除此条之后的所有消息,并在此继续对话(不可撤销)";
				if (busy) {
					label = "…";
					title = "正在删除后续内容";
				} else if (notice !== null) {
					label = "⚠";
					title = notice;
				} else if (armed) {
					title = "再次点击确认:永久删除此条之后的所有消息";
				}
				return React.createElement("button", {
					className: "dsh-rollback-action" + (armed ? " dsh-rollback-action-armed" : ""),
					type: "button",
					"aria-label": "回退到此",
					title,
					disabled: busy || running,
					onClick: runRollback
				}, label);
			}

			// Shadow the official `user` renderer as soon as one exists: the immediate
			// reconcile covers the already-registered case, the entry subscription
			// covers registration that lands later (the normal order on this build).
			ctx.effect(() => slots.subscribe("conversation.chat.node", reconcileUserTakeover), "conversation-rollback: user node takeover watch");
			ctx.effect(() => () => {
				if (disposeUserTakeover === null) return;
				disposeUserTakeover();
				disposeUserTakeover = null;
			}, "conversation-rollback: user node takeover lifetime");
			reconcileUserTakeover();
			slots.inject("conversation.chat.user-actions", () => slots.register(
				{
					name: "conversation.chat.user-actions",
					id: "conversation-rollback-edit",
					order: 10
				},
				UserEditAction
			));
			slots.inject("conversation.chat.assistant-actions", () => slots.register(
				{
					name: "conversation.chat.assistant-actions",
					id: "conversation-rollback-rollback",
					order: 10
				},
				RollbackAssistantAction
			));
		}
		/* == session-toc: BEGIN generated section (tools/merge-client.mjs) ==
		 * Author the rail in src/session-toc.js and run `pnpm run build`.
		 * `node tools/merge-client.mjs --strip` recovers the rollback-only bundle.
		 *
		 * The IIFE is load-bearing: the rail declares `apply`, and a second
		 * `function apply` in this scope would silently override the rollback half.
		 * == preamble END == */
		const SessionToc = (function () {
    var React = require('react')
    var ReactDOMClient = require('react-dom/client')
    var h = React.createElement

    var LOG = '[conversation-rollback/session-toc]'
    // Must be the MERGED package name: that is the loader entry name HMR
    // addresses, and the value `removeOwnedStyles` matches in `data-plugin`
    // (dsh-client-hmr client.js:26-29). A stale 'dsh-session-toc' here would
    // make the style tag unreclaimable now that the two plugins are one.
    var PLUGIN_ID = 'conversation-rollback'
    var CSS_TAG = 'conversation-rollback/session-toc.css'
    // Key kept from the standalone plugin on purpose: existing pinned rails
    // survive the merge, and the namespace is still unique.
    var STORE_PINNED = 'dsh-session-toc:pinned'
    var MAX_OLDER_PAGES = 40
    var ROW_CLAMP = 140

    // ----------------------------------------------------------------- copy

    var COPY = {
      zh: {
        title: '目录',
        toggle: '显示/隐藏会话目录',
        empty: '这个会话还没有你的提问',
        search: '搜索提问…',
        jump: '跳转到这一轮',
        more: '载入更早',
        loading: '载入中…',
        allLoaded: '已载入全部历史',
        noMatch: '已载入范围内没有匹配',
        pagingHint: '正在向更早翻页以寻找匹配…',
        notVisible: '当前视图不是聊天视图，切回「聊天」后再跳转',
        pageFailed: '载入更早失败',
        footTurns: '条提问',
      },
      en: {
        title: 'Outline',
        toggle: 'Show / hide session outline',
        empty: 'No prompts in this session yet',
        search: 'Search prompts…',
        jump: 'Jump to this turn',
        more: 'Load earlier',
        loading: 'Loading…',
        allLoaded: 'All history loaded',
        noMatch: 'No match in the loaded window',
        pagingHint: 'Paging backwards to find a match…',
        notVisible: 'The chat view is not active — switch back to Chat to jump',
        pageFailed: 'Failed to load earlier history',
        footTurns: 'prompts',
      },
    }

    // ------------------------------------------------------------------ css

    var CSS = [
      '.dsh-toc-root{position:fixed;top:50%;transform:translateY(-50%);z-index:45;display:flex;align-items:flex-start;gap:6px;pointer-events:none;',
      'font-family:var(--dsw-font-family-base,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif)}',
      '.dsh-toc-strip{pointer-events:auto;display:flex;flex-direction:column;align-items:center;gap:7px;width:26px;padding:8px 2px;',
      'border:1px solid var(--dsw-alias-border-l1,#e2e8f0);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);',
      'box-shadow:0 4px 16px rgba(2,8,23,.12);opacity:.55;transition:opacity .15s ease;',
      // Height tracks the conversation band, so a side-card bottom panel never
      // slides over the rail (`--dsh-toc-band` is written by the geometry effect).
      'max-height:min(72vh, var(--dsh-toc-band, 72vh));overflow:hidden}',
      '.dsh-toc-root:hover{opacity:1}.dsh-toc-root:hover .dsh-toc-strip,.dsh-toc-strip.on{opacity:1}',
      '.dsh-toc-strip-btn{width:18px;height:18px;padding:0;border:none;border-radius:6px;background:transparent;cursor:pointer;',
      'color:var(--dsw-alias-label-secondary,#64748b);font-size:12px;line-height:18px}',
      '.dsh-toc-strip-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary,#0f172a)}',
      '.dsh-toc-ticks{display:flex;flex-direction:column;align-items:center;gap:3px;width:100%;overflow:hidden}',
      '.dsh-toc-tick{flex:none;width:14px;height:3px;border:none;border-radius:2px;padding:0;cursor:pointer;',
      'background:var(--dsw-alias-border-l2,#cbd5e1);transition:background .12s ease,width .12s ease}',
      '.dsh-toc-tick:hover{background:var(--dsw-alias-brand-primary,#2563eb);width:16px}',
      '.dsh-toc-tick.active{background:var(--dsw-alias-brand-primary,#2563eb);width:16px}',
      '.dsh-toc-tick.more{height:12px;background:linear-gradient(180deg,var(--dsw-alias-border-l2,#cbd5e1),transparent)}',
      '.dsh-toc-panel{pointer-events:auto;display:flex;flex-direction:column;width:300px;max-height:min(72vh, var(--dsh-toc-band, 72vh));',
      'border:1px solid var(--dsw-alias-border-l1,#e2e8f0);border-radius:14px;background:var(--dsw-alias-bg-overlay,#fff);',
      'box-shadow:0 14px 40px rgba(2,8,23,.22);overflow:hidden}',
      '.dsh-toc-head{display:flex;align-items:center;gap:8px;padding:9px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,#e2e8f0)}',
      '.dsh-toc-title{flex:1;font-size:13px;font-weight:650;color:var(--dsw-alias-label-primary,#0f172a)}',
      '.dsh-toc-icon-btn{width:22px;height:22px;flex:none;border:none;border-radius:6px;background:transparent;cursor:pointer;',
      'color:var(--dsw-alias-label-secondary,#64748b);font-size:13px;line-height:22px}',
      '.dsh-toc-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary,#0f172a)}',
      '.dsh-toc-search{width:100%;box-sizing:border-box;border:none;outline:none;padding:8px 12px;font-size:12.5px;',
      'background:transparent;color:var(--dsw-alias-label-primary,#0f172a);border-bottom:1px solid var(--dsw-alias-border-l1,#e2e8f0)}',
      '.dsh-toc-list{flex:1;min-height:0;overflow-y:auto;padding:5px}',
      '.dsh-toc-row{display:flex;align-items:flex-start;gap:8px;width:100%;text-align:left;border:none;background:transparent;',
      'cursor:pointer;padding:6px 8px;border-radius:9px;color:inherit}',
      '.dsh-toc-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}',
      '.dsh-toc-row.active{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.16))}',
      '.dsh-toc-row-n{flex:none;min-width:24px;text-align:right;padding-top:1px;font-size:11px;font-variant-numeric:tabular-nums;',
      'color:var(--dsw-alias-label-caption,#94a3b8)}',
      '.dsh-toc-row-main{min-width:0;flex:1}',
      '.dsh-toc-row-t{font-size:12.5px;line-height:1.45;color:var(--dsw-alias-label-primary,#0f172a);display:-webkit-box;',
      '-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}',
      '.dsh-toc-row-m{font-size:10.5px;color:var(--dsw-alias-label-caption,#94a3b8);margin-top:2px}',
      '.dsh-toc-empty{padding:14px 12px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#94a3b8)}',
      '.dsh-toc-foot{display:flex;align-items:center;gap:8px;padding:7px 10px;border-top:1px solid var(--dsw-alias-border-l1,#e2e8f0);',
      'font-size:11.5px;color:var(--dsw-alias-label-secondary,#64748b)}',
      '.dsh-toc-foot-btn{flex:none;border:1px solid var(--dsw-alias-border-l1,#e2e8f0);border-radius:9px;background:transparent;',
      'cursor:pointer;padding:3px 9px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#64748b)}',
      '.dsh-toc-foot-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary,#0f172a);background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}',
      '.dsh-toc-foot-note{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-toc-header-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:none;',
      'border-radius:8px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary,#64748b);font-size:13px}',
      '.dsh-toc-header-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14))}',
      '.dsh-toc-header-btn.on{color:var(--dsw-alias-brand-primary,#2563eb)}',
      '.dsh-toc-flash{animation:dsh-toc-flash 1.3s ease}',
      '@keyframes dsh-toc-flash{0%{background:rgba(37,99,235,.18)}100%{background:transparent}}',
      '.dsh-toc-bar{position:fixed;left:8px;bottom:8px;z-index:2147483000;max-width:70vw;padding:8px 12px;font:12px/1.5 ui-monospace,monospace;',
      'color:#f2a1a1;background:#1b1b22;border:1px solid #f2a1a1;border-radius:8px;white-space:pre-wrap}',
    ].join('')

    // --------------------------------------------------------------- helpers

    function textOf(content) {
      if (!Array.isArray(content)) return ''
      var parts = []
      for (var i = 0; i < content.length; i++) {
        var block = content[i]
        if (!block) continue
        if ((block.type === 'text' || block.kind === 'text') && typeof block.text === 'string') parts.push(block.text)
      }
      return parts.join(' ')
    }

    function oneLine(value) {
      return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
    }

    function turnOf(location) {
      if (!location) return null
      if (location.kind !== 'turn' && location.kind !== 'step') return null
      var turn = location.turn && location.turn.turn
      return typeof turn === 'number' && isFinite(turn) ? turn : null
    }

    function timeOfTurn(chat, turn) {
      if (turn === null || !chat || !chat.timeline || !chat.timeline.turns) return null
      var record = null
      try {
        record = typeof chat.timeline.turns.get === 'function' ? chat.timeline.turns.get(turn) : null
      } catch (error) {
        return null
      }
      var event = record && (record.end || record.start)
      if (event && event.event && typeof event.event.time === 'number') return event.event.time
      return event && typeof event.time === 'number' ? event.time : null
    }

    function clockOf(ms) {
      if (typeof ms !== 'number') return ''
      var d = new Date(ms)
      var now = new Date()
      var hh = d.getHours()
      var mm = d.getMinutes()
      var sameDay = d.getFullYear() === now.getFullYear() && d.getDate() === now.getDate() && d.getMonth() === now.getMonth()
      var clock = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm
      if (sameDay) return clock
      var mo = d.getMonth() + 1
      var day = d.getDate()
      return (mo < 10 ? '0' : '') + mo + '/' + (day < 10 ? '0' : '') + day + ' ' + clock
    }

    /** One outline row per Chat Node the user sent (a plain prompt or a steer). */
    function buildOutline(chat) {
      var rows = []
      if (!chat || !Array.isArray(chat.order) || !chat.nodes || typeof chat.nodes.get !== 'function') return rows
      for (var i = 0; i < chat.order.length; i++) {
        var key = chat.order[i]
        var node = null
        try {
          node = chat.nodes.get(key)
        } catch (error) {
          node = null
        }
        if (!node || (node.kind !== 'user' && node.kind !== 'steering')) continue
        var text = oneLine(textOf(node.data && node.data.content))
        if (text === '') continue
        var turn = turnOf(node.location)
        rows.push({
          key: String(key),
          turn: turn,
          steering: node.kind === 'steering',
          text: text,
          time: timeOfTurn(chat, turn),
        })
      }
      return rows
    }

    function sameRows(left, right) {
      if (left === right) return true
      if (!left || !right || left.length !== right.length) return false
      for (var i = 0; i < left.length; i++) {
        if (left[i].key !== right[i].key || left[i].text !== right[i].text) return false
      }
      return true
    }

    function matches(row, needle) {
      if (needle === '') return true
      return row.text.toLowerCase().indexOf(needle) !== -1
            || (row.turn !== null && String(row.turn) === needle)
    }

    function getScroller() {
      var all = document.querySelectorAll('[data-conversation-scroll]')
      if (!all.length) return null
      return all[all.length - 1]
    }

    /** Same lookup the core's own anchorElement() uses: rows carry data-chat-anchor-key. */
    function findRow(scroller, key) {
      var rows = scroller.querySelectorAll('[data-chat-anchor-key]')
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].dataset && rows[i].dataset.chatAnchorKey === key) return rows[i]
      }
      return null
    }

    function rowElements(scroller) {
      return Array.prototype.slice.call(scroller.querySelectorAll('[data-chat-anchor-key]'))
    }

    function jumpTo(key) {
      var scroller = getScroller()
      if (!scroller) return false
      var el = findRow(scroller, key)
      if (!el) return false
      var top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
      scroller.scrollTop = Math.max(0, Math.round(top - 16))
      try {
        el.classList.remove('dsh-toc-flash')
        void el.offsetWidth
        el.classList.add('dsh-toc-flash')
        window.setTimeout(function () {
          try {
            el.classList.remove('dsh-toc-flash')
          } catch (error) {}
        }, 1400)
      } catch (error) {}
      return true
    }

    /**
     * Remember the first row currently inside the scroll host, as
     * `<ui-conversation>'s own anchorRef>` does for its 「加载更早」 button
     * (CONV:5530-5542 + the compensation in CONV:5443-5455). Prepending a page
     * only ever adds rows ABOVE the anchor (node keys survive a prepend), so
     * the anchor's new viewport offset minus its old one is exactly the
     * scrollTop delta that keeps the reader where they were.
     *
     * Returns null while pinned to the tail: there the core's own tail-follow
     * owns the position (CONV:5456-5463) and a second writer would fight it.
     */
    function captureAnchor() {
      var scroller = getScroller()
      if (!scroller) return null
      var bottom = Math.max(0, scroller.scrollHeight - scroller.clientHeight) - scroller.scrollTop
      if (bottom <= 25) return null
      var host = scroller.getBoundingClientRect()
      var rows = scroller.querySelectorAll('[data-chat-anchor-key]')
      for (var i = 0; i < rows.length; i++) {
        var key = rows[i].dataset && rows[i].dataset.chatAnchorKey
        if (!key) continue
        var top = rows[i].getBoundingClientRect().top - host.top
        // The first row that has not scrolled past the host's top edge.
        if (top >= -1) return { scroller: scroller, key: key, top: top }
      }
      return null
    }

    /** Undo a page prepend's visual jump. See `captureAnchor`. */
    function restoreAnchor(anchor, atSecondFrame) {
      if (!anchor) return
      var done = function () {
        try {
          if (!anchor.scroller.isConnected) return
          var el = findRow(anchor.scroller, anchor.key)
          if (!el) return
          var delta = el.getBoundingClientRect().top - anchor.scroller.getBoundingClientRect().top - anchor.top
          if (delta !== 0) anchor.scroller.scrollTop += delta
        } catch (error) {}
      }
      if (typeof window.requestAnimationFrame !== 'function') {
        done()
        return
      }
      // One frame to let the prepend commit, one more to let layout settle.
      window.requestAnimationFrame(function () {
        if (atSecondFrame) done()
        else window.requestAnimationFrame(done)
      })
    }

    function readPinned() {
      try {
        return window.localStorage.getItem(STORE_PINNED) === '1'
      } catch (error) {
        return false
      }
    }

    function writePinned(value) {
      try {
        window.localStorage.setItem(STORE_PINNED, value ? '1' : '0')
      } catch (error) {}
    }

    function sleep(ms) {
      return new Promise(function (resolve) {
        window.setTimeout(resolve, ms)
      })
    }

    // ----------------------------------------------------------------- store

    /**
     * Session-bound outline store. It is the single writer of the rail's state:
     * the Chat target feeds `rows`, the session snapshot feeds
     * `hasMore/loadingOlder`, the UI writes `pinned/query/activeKey`.
     * `getSnapshot()` is reference-stable between notifications so React can
     * consume it through useSyncExternalStore.
     *
     * `chatTargetFor(binding)` resolves the session's Chat target source
     * (DSH >= 0.1.2-rc.1 exposes the Chat target as a per-session view target;
     * older builds carried it on the session snapshot as `snapshot.chat`).
     */
    function createStore(sessions, timer, chatTargetFor) {
      var listeners = {}
      var nextListener = 1
      var state = {
        sessionId: null,
        rows: [],
        hasMore: false,
        loadingOlder: false,
        error: null,
        pinned: readPinned(),
        query: '',
        activeKey: null,
      }
      var boundId = null
      var boundSession = null
      var boundChat = null
      var unsubSession = null
      var unsubChat = null
      var unsubList = null
      var retryTimer = null
      var retryBudget = 40
      var disposed = false

      function emit() {
        for (var id in listeners) {
          try {
            listeners[id]()
          } catch (error) {
            console.error(LOG, 'listener failed', error)
          }
        }
      }

      function set(patch) {
        var changed = false
        for (var key in patch) {
          if (state[key] !== patch[key]) {
            changed = true
            break
          }
        }
        if (!changed) return
        state = Object.assign({}, state, patch)
        emit()
      }

      function subscribe(listener) {
        var id = nextListener++
        listeners[id] = listener
        return function () {
          delete listeners[id]
        }
      }

      function getSnapshot() {
        return state
      }

      function currentId() {
        try {
          return sessions.list.getSnapshot().current || null
        } catch (error) {
          return null
        }
      }

      /** Latest Chat target snapshot: the live view target first, the legacy
       * session-snapshot `chat` field as a fallback for older builds. */
      function chatSnapshot() {
        if (boundChat) {
          try {
            var chat = boundChat.getSnapshot()
            if (chat) return chat
          } catch (error) {}
        }
        if (!boundSession) return null
        try {
          var snapshot = boundSession.getSnapshot()
          return (snapshot && snapshot.chat) || null
        } catch (error) {
          return null
        }
      }

      function refresh() {
        if (!boundSession || disposed) return
        var snapshot = null
        try {
          snapshot = boundSession.getSnapshot()
        } catch (error) {
          return
        }
        var rows = buildOutline(chatSnapshot())
        set({
          rows: sameRows(state.rows, rows) ? state.rows : rows,
          hasMore: !!(snapshot && snapshot.hasMore),
          loadingOlder: !!(snapshot && snapshot.loadingOlder),
        })
      }

      function detachSession() {
        if (unsubSession) {
          try {
            unsubSession()
          } catch (error) {}
          unsubSession = null
        }
        if (unsubChat) {
          try {
            unsubChat()
          } catch (error) {}
          unsubChat = null
        }
        boundSession = null
        boundChat = null
      }

      function bind(id) {
        if (disposed) return
        if (id === boundId && (boundSession || retryBudget <= 0)) return
        detachSession()
        boundId = id || null
        var binding = null
        if (boundId) {
          try {
            binding = sessions.binding(boundId)
          } catch (error) {
            binding = null
          }
        }
        var session = binding && binding.session
        if (session && typeof session.subscribe === 'function' && typeof session.getSnapshot === 'function') {
          boundSession = session
          retryBudget = 40
          try {
            unsubSession = session.subscribe(function () {
              refresh()
            })
          } catch (error) {
            console.error(LOG, 'subscribe failed', error)
          }
        }
        // The Chat target lives outside the session snapshot on this build, so the
        // outline follows its own source; subscribing also activates the target.
        if (binding && typeof chatTargetFor === 'function') {
          try {
            var target = chatTargetFor(binding)
            if (target && typeof target.subscribe === 'function' && typeof target.getSnapshot === 'function') {
              boundChat = target
              unsubChat = target.subscribe(function () {
                refresh()
              })
            }
          } catch (error) {
            console.error(LOG, 'chat target unavailable', error)
          }
        }
        set({ sessionId: boundId, rows: [], hasMore: false, loadingOlder: false, activeKey: null, error: null })
        if (boundSession) refresh()
        else scheduleRetry()
      }

      /** The binding can lag the list feed right after a session opens. */
      function scheduleRetry() {
        if (disposed || boundSession || retryBudget <= 0) return
        retryBudget--
        var run = function () {
          if (disposed || boundSession) return
          var id = currentId()
          boundId = null
          bind(id)
        }
        if (timer && typeof timer.timeout === 'function') timer.timeout(run, 600)
        else retryTimer = window.setTimeout(run, 600)
      }

      function start() {
        try {
          unsubList = sessions.list.subscribe(function () {
            bind(currentId())
          })
        } catch (error) {
          console.error(LOG, 'list feed unavailable', error)
        }
        bind(currentId())
      }

      function dispose() {
        disposed = true
        if (unsubList) {
          try {
            unsubList()
          } catch (error) {}
          unsubList = null
        }
        detachSession()
        if (retryTimer !== null) {
          window.clearTimeout(retryTimer)
          retryTimer = null
        }
        listeners = {}
      }

      /** Pull one older page. Resolves whether anything was actually pulled. */
      function loadOlder() {
        if (!boundSession || typeof boundSession.loadOlder !== 'function') return Promise.resolve(false)
        if (!state.hasMore || state.loadingOlder) return Promise.resolve(false)
        try {
          // The core re-anchors the viewport only for its own 「加载更早」
          // button, so a page pulled from here (the rail's button, or the
          // auto-paging a search triggers) must carry its own anchor or every
          // page yanks the reader somewhere else.
          var anchor = captureAnchor()
          return Promise.resolve(boundSession.loadOlder()).then(
            function () {
              set({ error: null })
              restoreAnchor(anchor)
              return true
            },
            function (error) {
              console.error(LOG, 'loadOlder failed', error)
              set({ error: String((error && error.message) || error) })
              return false
            },
          )
        } catch (error) {
          return Promise.resolve(false)
        }
      }

      function togglePinned() {
        var next = !state.pinned
        writePinned(next)
        set({ pinned: next })
      }

      return {
        subscribe: subscribe,
        getSnapshot: getSnapshot,
        set: set,
        start: start,
        dispose: dispose,
        loadOlder: loadOlder,
        togglePinned: togglePinned,
      }
    }

    function useStore(store) {
      if (typeof React.useSyncExternalStore === 'function') {
        return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
      }
      var snapshot = store.getSnapshot()
      var setter = React.useState(snapshot)[1]
      React.useEffect(function () {
        return store.subscribe(function () {
          setter(store.getSnapshot())
        })
      }, [store])
      return snapshot
    }

    // ------------------------------------------------------------ components

    /** Collapse the tick list so a 900-turn session still fits the viewport. */
    function tickList(rows, activeKey) {
      var ticks = []
      if (!rows.length) return ticks
      var step = Math.max(1, Math.ceil(rows.length / ROW_CLAMP))
      for (var i = 0; i < rows.length; i += step) {
        ticks.push({ key: rows[i].key, label: rows[i].text, active: rows[i].key === activeKey })
      }
      var last = rows[rows.length - 1]
      if (!ticks.length || ticks[ticks.length - 1].key !== last.key) {
        ticks.push({ key: last.key, label: last.text, active: last.key === activeKey })
      }
      return ticks
    }

    function makeRail(store, copy) {
      function Rail() {
        var s = useStore(store)
        var hoverRef = React.useState(false)
        var hover = hoverRef[0]
        var setHover = hoverRef[1]
        var rightRef = React.useState(10)
        var right = rightRef[0]
        var setRight = rightRef[1]
        // Vertical anchor follows the conversation band's middle, so the rail
        // clears the session header, the sticky composer and the side card's
        // bottom panel. Null keeps the stylesheet's 50% fallback.
        var topRef = React.useState(null)
        var top = topRef[0]
        var setTop = topRef[1]
        var noticeRef = React.useState(null)
        var notice = noticeRef[0]
        var setNotice = noticeRef[1]
        var inputRef = React.useRef(null)
        var listRef = React.useRef(null)
        var rootRef = React.useRef(null)
        var expanded = s.pinned || hover
        var query = s.query.trim().toLowerCase()
        var rows = s.rows

        var shown = React.useMemo(function () {
          if (query === '') return rows
          return rows.filter(function (row) {
            return matches(row, query)
          })
        }, [rows, query])

        // Sit on the conversation column, never on the window. dsh-better-sidebar
        // takes its width OUT of the shell (`#root { margin-right: var(--dsh-sidebar-width) }`,
        // its own layout.css) and paints the fixed panel over the strip it just
        // vacated; DSH's own details column and that plugin's bottom panel
        // squeeze the same way. A window-anchored rail therefore lands exactly
        // under the panel. Anchoring on the scroll host's rect clears all of
        // them by construction, and avoids a z-index war (that plugin stacks
        // 50/52/55/60 for its own menus — out-ranking 60 would bury its menus).
        React.useEffect(function () {
          var frame = 0
          var observer = null
          var watched = null
          var measure = function () {
            frame = 0
            var scroller = getScroller()
            if (!scroller) return
            var rect = scroller.getBoundingClientRect()
            if (rect.width < 120 || rect.height < 120) return
            var next = Math.round(window.innerWidth - rect.right + 10)
            if (next < 4) next = 4
            setRight(next)
            setTop(Math.round(rect.top + rect.height / 2))
            // Keep the rail inside the conversation band vertically: the side
            // card's bottom panel squeezes this same column from below.
            if (rootRef.current && rootRef.current.style) {
              rootRef.current.style.setProperty('--dsh-toc-band', Math.round(Math.max(200, rect.height * 0.86)) + 'px')
            }
          }
          var schedule = function () {
            if (!frame) frame = window.requestAnimationFrame(measure)
          }
          var watch = function () {
            var scroller = getScroller()
            if (scroller === watched) return
            if (observer !== null) {
              observer.disconnect()
              observer = null
            }
            watched = scroller
            if (scroller && typeof window.ResizeObserver === 'function') {
              // Also fires THROUGH the open/close transition: the squeezed
              // column width animates, so the rail slides with it instead of
              // lagging a poll interval under the moving panel.
              observer = new window.ResizeObserver(schedule)
              observer.observe(scroller)
            }
            schedule()
          }
          watch()
          window.addEventListener('resize', schedule)
          var poll = window.setInterval(watch, 1000)
          return function () {
            if (frame) window.cancelAnimationFrame(frame)
            if (observer !== null) observer.disconnect()
            window.removeEventListener('resize', schedule)
            window.clearInterval(poll)
          }
        }, [])

        // Track the turn under the top edge of the scroll host.
        React.useEffect(function () {
          var el = null
          var frame = 0
          var cache = { rows: null, elements: null, scroller: null }
          var compute = function () {
            frame = 0
            var scroller = getScroller()
            if (!scroller) return
            var live = store.getSnapshot().rows
            if (!live.length) return
            // The cached rows go stale whenever the window changed OR the chat
            // view remounted (view tabs reuse the same scroll host), so the
            // cache is only trusted while its first row is still inside it.
            if (cache.scroller !== scroller || cache.rows !== live || (cache.elements[0] && !scroller.contains(cache.elements[0]))) {
              cache = { scroller: scroller, rows: live, elements: rowElements(scroller) }
            }
            var byKey = {}
            for (var i = 0; i < live.length; i++) byKey[live[i].key] = live[i].key
            var probe = scroller.getBoundingClientRect().top + 90
            var elements = cache.elements
            if (!elements.length) return
            // Binary search: document order is visual order, so tops ascend.
            var low = 0
            var high = elements.length - 1
            var best = -1
            while (low <= high) {
              var mid = (low + high) >> 1
              var top = elements[mid].getBoundingClientRect().top
              if (top <= probe) {
                best = mid
                low = mid + 1
              } else high = mid - 1
            }
            var active = null
            for (var j = best; j >= 0; j--) {
              var key = elements[j].dataset && elements[j].dataset.chatAnchorKey
              if (key && byKey[key] !== undefined) {
                active = key
                break
              }
            }
            if (active === null) active = live[0].key
            if (store.getSnapshot().activeKey !== active) store.set({ activeKey: active })
          }
          var schedule = function () {
            if (!frame) frame = window.requestAnimationFrame(compute)
          }
          var attach = function () {
            var scroller = getScroller()
            if (scroller === el) return
            if (el) el.removeEventListener('scroll', schedule)
            el = scroller
            cache = { rows: null, elements: null, scroller: null }
            if (el) el.addEventListener('scroll', schedule, { passive: true })
            schedule()
          }
          attach()
          var poll = window.setInterval(attach, 1200)
          return function () {
            if (el) el.removeEventListener('scroll', schedule)
            if (frame) window.cancelAnimationFrame(frame)
            window.clearInterval(poll)
          }
        }, [store])

        // A search with no hit in the loaded window keeps paging backwards.
        React.useEffect(function () {
          var needle = query
          if (needle === '') return
          var cancelled = false
          void (async function () {
            for (var page = 0; page < MAX_OLDER_PAGES; page++) {
              if (cancelled) return
              var current = store.getSnapshot()
              var hit = current.rows.some(function (row) {
                return matches(row, needle)
              })
              if (hit || !current.hasMore) return
              if (current.loadingOlder) {
                await sleep(400)
                continue
              }
              var pulled = await store.loadOlder()
              if (!pulled && !store.getSnapshot().hasMore) return
              await sleep(120)
            }
          })()
          return function () {
            cancelled = true
          }
        }, [query, store])

        // Ctrl/Cmd+Shift+O toggles the rail.
        React.useEffect(function () {
          var onKey = function (event) {
            if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'O' || event.key === 'o')) {
              event.preventDefault()
              store.togglePinned()
            }
          }
          window.addEventListener('keydown', onKey)
          return function () {
            window.removeEventListener('keydown', onKey)
          }
        }, [store])

        var jump = function (row) {
          if (jumpTo(row.key)) {
            store.set({ activeKey: row.key })
            setNotice(null)
          } else {
            setNotice(copy.notVisible)
            window.setTimeout(function () {
              setNotice(null)
            }, 2600)
          }
        }

        if (!s.sessionId || !rows.length) return null

        var ticks = tickList(rows, s.activeKey)

        return h(
          'div',
          {
            className: 'dsh-toc-root',
            ref: rootRef,
            style: { right: right + 'px', top: top === null ? '50%' : top + 'px' },
            onMouseEnter: function () {
              setHover(true)
            },
            onMouseLeave: function () {
              setHover(false)
            },
          },
          expanded
            ? h(
                'div',
                { className: 'dsh-toc-panel' },
                h(
                  'div',
                  { className: 'dsh-toc-head' },
                  h('div', { className: 'dsh-toc-title' }, copy.title + ' · ' + rows.length + ' ' + copy.footTurns),
                  s.hasMore
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsh-toc-icon-btn',
                          title: copy.more,
                          'aria-label': copy.more,
                          disabled: s.loadingOlder,
                          onClick: function () {
                            void store.loadOlder()
                          },
                        },
                        s.loadingOlder ? '…' : '⟳',
                      )
                    : null,
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-toc-icon-btn',
                      title: copy.toggle,
                      'aria-label': copy.toggle,
                      onClick: function () {
                        store.togglePinned()
                        setHover(false)
                      },
                    },
                    '×',
                  ),
                ),
                h('input', {
                  ref: inputRef,
                  className: 'dsh-toc-search',
                  type: 'search',
                  placeholder: copy.search,
                  value: s.query,
                  spellCheck: false,
                  onChange: function (event) {
                    store.set({ query: event.target.value })
                  },
                  onKeyDown: function (event) {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      store.set({ query: '' })
                    }
                  },
                }),
                h(
                  'div',
                  { className: 'dsh-toc-list', ref: listRef },
                  shown.length === 0
                    ? h('div', { className: 'dsh-toc-empty' }, query === '' ? copy.empty : copy.noMatch)
                    : shown.map(function (row, index) {
                        return h(
                          'button',
                          {
                            key: row.key,
                            type: 'button',
                            className: 'dsh-toc-row' + (row.key === s.activeKey ? ' active' : ''),
                            title: copy.jump,
                            onClick: function () {
                              jump(row)
                            },
                          },
                          h('span', { className: 'dsh-toc-row-n' }, row.turn === null ? index + 1 : row.turn),
                          h(
                            'span',
                            { className: 'dsh-toc-row-main' },
                            h('span', { className: 'dsh-toc-row-t' }, row.text),
                            h(
                              'span',
                              { className: 'dsh-toc-row-m' },
                              [row.steering ? 'steer' : null, clockOf(row.time)].filter(Boolean).join(' · '),
                            ),
                          ),
                        )
                      }),
                ),
                h(
                  'div',
                  { className: 'dsh-toc-foot' },
                  h('span', { className: 'dsh-toc-foot-note' }, s.hasMore ? (s.loadingOlder ? copy.loading : copy.pagingHint) : copy.allLoaded),
                  s.hasMore
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsh-toc-foot-btn',
                          disabled: s.loadingOlder,
                          onClick: function () {
                            void store.loadOlder()
                          },
                        },
                        copy.more,
                      )
                    : null,
                ),
                notice || s.error ? h('div', { className: 'dsh-toc-empty' }, notice || (copy.pageFailed + '：' + s.error)) : null,
              )
            : h(
                'div',
                { className: 'dsh-toc-strip' + (s.pinned ? ' on' : '') },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-toc-strip-btn',
                    title: copy.toggle,
                    'aria-label': copy.toggle,
                    onClick: function () {
                      store.togglePinned()
                    },
                  },
                  '☰',
                ),
                h(
                  'div',
                  { className: 'dsh-toc-ticks' },
                  ticks.map(function (tick) {
                    return h('button', {
                      key: tick.key,
                      type: 'button',
                      className: 'dsh-toc-tick' + (tick.active ? ' active' : ''),
                      title: tick.label,
                      onClick: function () {
                        jumpTo(tick.key)
                        store.set({ activeKey: tick.key })
                      },
                    })
                  }),
                  s.hasMore
                    ? h('button', {
                        type: 'button',
                        className: 'dsh-toc-tick more',
                        title: copy.more,
                        onClick: function () {
                          void store.loadOlder()
                        },
                      })
                    : null,
                ),
              ),
        )
      }
      return Rail
    }

    // ----------------------------------------------------------------- entry

    function apply(ctx) {
      var copy = COPY.zh
      try {
        var locale = ctx.get('locale')
        if (locale && typeof locale.getSnapshot === 'function') {
          var active = String(locale.getSnapshot().active || '')
          if (active.indexOf('en') === 0) copy = COPY.en
        }
      } catch (error) {}

      var fail = function (phase, error) {
        console.error(LOG, phase + ' error:', error)
        try {
          var bar = document.createElement('div')
          bar.className = 'dsh-toc-bar'
          bar.textContent = LOG + ' ' + phase + ' error: ' + ((error && error.message) || error)
          document.body.appendChild(bar)
        } catch (ignored) {}
      }

      var sessions = ctx.get('sessions')
      if (!sessions || !sessions.list) {
        console.warn(LOG, 'sessions service unavailable — rail disabled')
        return
      }

      var store = createStore(sessions, ctx.get('timer'), function (binding) {
        // The Conversation service owns the per-session view targets; resolve it
        // lazily, because it may activate after this plugin does.
        var uiConversation = ctx.get('uiConversation')
        if (!uiConversation || typeof uiConversation.binding !== 'function') return null
        return uiConversation.binding(binding).target('chat')
      })

      try {
        // Official style ownership: `style[data-plugin="<package name>"]` is what
        // dsh-client-hmr reclaims on a hot swap (dsh-client-hmr client.js:26-29
        // matches the attribute verbatim against the loader entry name), and the
        // `data-plugin-css` tag id dedupes a double activation. Anything else
        // leaves a stale <style> behind on every rebuild.
        if (!document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG) + ']')) {
          var style = document.createElement('style')
          style.dataset.plugin = PLUGIN_ID
          style.dataset.pluginCss = CSS_TAG
          style.textContent = CSS
          document.head.appendChild(style)
          ctx.effect(function () {
            return function () {
              style.remove()
            }
          }, 'dsh-session-toc: styles')
        }

        ctx.effect(function () {
          var root = null
          var host = null
          try {
            store.start()
            host = document.createElement('div')
            host.setAttribute('data-dsh-session-toc', '')
            document.body.appendChild(host)
            root = ReactDOMClient.createRoot(host)
            root.render(h(makeRail(store, copy), { store: store }))
          } catch (error) {
            fail('mount', error)
          }
          return function () {
            try {
              if (root) root.unmount()
            } catch (error) {}
            try {
              if (host) host.remove()
            } catch (error) {}
            store.dispose()
          }
        }, 'dsh-session-toc: rail mount')

        var slots = ctx.get('slots')
        if (slots && typeof slots.inject === 'function' && typeof slots.register === 'function') {
          ctx.effect(
            function () {
              return slots.inject('conversation.session.header.utilities', function () {
                // `slots.inject` runs this callback INSIDE the owner's own
                // register() call, so a throw here would take the conversation
                // header down with it. Registration stays best-effort: the rail
                // itself works without the header button.
                try {
                  return slots.register(
                    {
                      name: 'conversation.session.header.utilities',
                      id: 'session-toc',
                      order: 20,
                      label: copy.title,
                    },
                    function TocHeaderToggle() {
                      var s = useStore(store)
                      return h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsh-toc-header-btn' + (s.pinned ? ' on' : ''),
                          title: copy.toggle,
                          'aria-label': copy.toggle,
                          onClick: function () {
                            store.togglePinned()
                          },
                        },
                        '☰',
                      )
                    },
                  )
                } catch (error) {
                  console.error(LOG, 'header toggle unavailable (slot refused):', error)
                  return function () {}
                }
              })
            },
            'dsh-session-toc: header toggle',
          )
        }
      } catch (error) {
        fail('load', error)
      }
    }

			return { apply: apply }
		})();
		/* == session-toc: END generated section == */
		exports.name = "conversation-rollback";
		exports.inject = inject;
		/* == session-toc: BEGIN generated glue == */
		// Rollback first: it is what this package is named for, and a broken
		// rail must never take it down with it.
		exports.apply = function applyAll(ctx) {
			apply(ctx);
			try {
				SessionToc.apply(ctx);
			} catch (error) {
				console.warn("[conversation-rollback] session-toc disabled:", error);
			}
		};
		/* == session-toc: END generated glue == */
		return module.exports;
	}
});
