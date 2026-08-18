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
		function userTextForTurn(snapshot, turnNumber) {
			if (turnNumber === null) return null;
			const chat = snapshot && snapshot.chat;
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
		function turnHasImage(snapshot, turnNumber) {
			if (turnNumber === null) return false;
			const chat = snapshot && snapshot.chat;
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
		function finalAssistantFact(snapshot, messageId, fact) {
			if (!messageId) return null;
			const chat = snapshot && snapshot.chat;
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
			 */
			const originalUserEntry = slots.entries("conversation.chat.node").find((entry) => entry.options.key === "user");
			const OriginalUserMessageNodeView = originalUserEntry && originalUserEntry.component;
			function UserMessageNodeViewWithActions(props) {
				const { renderSlot, node } = props;
				const InnerUserMessageNodeView = OriginalUserMessageNodeView && OriginalUserMessageNodeView.type ? OriginalUserMessageNodeView.type : OriginalUserMessageNodeView;
				const rendered = typeof InnerUserMessageNodeView === "function" ? InnerUserMessageNodeView(props) : null;
				if (rendered === null || !React.isValidElement(rendered)) {
					return React.createElement(OriginalUserMessageNodeView, props);
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
				const isLatest = props.useSession((snapshot) => {
					const chat = snapshot && snapshot.chat;
					if (!chat || turnNumber === null) return true;
					const keys = chat.locations ? chat.locations.getTurn(turnNumber) : [];
					const lastKey = keys.length > 0 ? keys[keys.length - 1] : undefined;
					const order = chat.order;
					if (lastKey === undefined || !order || order.length === 0) return true;
					return order[order.length - 1] === lastKey;
				});
				const editableText = props.useSession((snapshot) => userTextForTurn(snapshot, turnNumber));
				const hasImage = props.useSession((snapshot) => turnHasImage(snapshot, turnNumber));
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
				const turnNumber = props.useSession((snapshot) => finalAssistantFact(snapshot, messageId, "turn"));
				const seq = props.useSession((snapshot) => finalAssistantFact(snapshot, messageId, "seq"));
				const [armed, setArmed] = React.useState(false);
				const [busy, setBusy] = React.useState(false);
				const [notice, setNotice] = React.useState(null);
				const running = props.useSession((snapshot) => Boolean(snapshot && snapshot.running));
				const isLatest = props.useSession((snapshot) => {
					const chat = snapshot && snapshot.chat;
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

			if (OriginalUserMessageNodeView !== undefined) {
				slots.inject("conversation.chat.node", () => slots.register(
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
				));
			}
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
		exports.name = "conversation-rollback";
		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
