/**
 * @name LastOnline
 * @author Kaerion
 * @version 1.0.1
 * @description Показывает под никнеймом когда в последний раз были в сети. Работает только для друзей
 * @source https://github.com/Kaerion0/LastOnline
 * @updateUrl https://raw.githubusercontent.com/Kaerion0/LastOnline/refs/heads/main/LastOnline.plugin.js
 * @changelog
 * тестовое обновление
 */

module.exports = (_ => {
	const changeLog = {};
	const DEFAULT_LOCALE = "ru";
	const TEXTS = {
		label: DEFAULT_LOCALE.startsWith("ru") ? "Последний онлайн" : "Last online",
		online: DEFAULT_LOCALE.startsWith("ru") ? "Сейчас в сети" : "Online now",
		justNow: DEFAULT_LOCALE.startsWith("ru") ? "Только что" : "Just now",
		noData: DEFAULT_LOCALE.startsWith("ru") ? "Еще нет данных" : "No data yet",
		ago: DEFAULT_LOCALE.startsWith("ru") ? "назад" : "ago"
	};

	return !window.BDFDB_Global || (!window.BDFDB_Global.loaded && !window.BDFDB_Global.started) ? class {
		constructor(meta) {
			for (let key in meta) this[key] = meta[key];
		}
		getName() {return this.name;}
		getAuthor() {return this.author;}
		getVersion() {return this.version;}
		getDescription() {return `The Library Plugin needed for ${this.name} is missing. Open the Plugin Settings to download it. \n\n${this.description}`;}

		downloadLibrary() {
			BdApi.Net.fetch("https://mwittrien.github.io/BetterDiscordAddons/Library/0BDFDB.plugin.js").then(r => {
				if (!r || r.status != 200) throw new Error();
				return r.text();
			}).then(b => {
				if (!b) throw new Error();
				return require("fs").writeFile(require("path").join(BdApi.Plugins.folder, "0BDFDB.plugin.js"), b, _ => BdApi.UI.showToast("Finished downloading BDFDB Library", {type: "success"}));
			}).catch(() => {
				BdApi.UI.alert("Error", "Could not download BDFDB Library Plugin. Try again later or download it manually from GitHub: https://mwittrien.github.io/downloader/?library");
			});
		}

		load() {
			if (!window.BDFDB_Global || !Array.isArray(window.BDFDB_Global.pluginQueue)) window.BDFDB_Global = Object.assign({}, window.BDFDB_Global, {pluginQueue: []});
			if (!window.BDFDB_Global.downloadModal) {
				window.BDFDB_Global.downloadModal = true;
				BdApi.UI.showConfirmationModal("Library Missing", `The Library Plugin needed for ${this.name} is missing. Please click "Download Now" to install it.`, {
					confirmText: "Download Now",
					cancelText: "Cancel",
					onCancel: _ => {delete window.BDFDB_Global.downloadModal;},
					onConfirm: _ => {
						delete window.BDFDB_Global.downloadModal;
						this.downloadLibrary();
					}
				});
			}
			if (!window.BDFDB_Global.pluginQueue.includes(this.name)) window.BDFDB_Global.pluginQueue.push(this.name);
		}
		start() {this.load();}
		stop() {}
		getSettingsPanel() {
			const template = document.createElement("template");
			template.innerHTML = `<div style="color: var(--text-primary); font-size: 16px; font-weight: 300; white-space: pre; line-height: 22px;">The Library Plugin needed for ${this.name} is missing.\nPlease click <a style="font-weight: 500;">Download Now</a> to install it.</div>`;
			template.content.firstElementChild.querySelector("a").addEventListener("click", this.downloadLibrary);
			return template.content.firstElementChild;
		}
	} : (([Plugin, BDFDB]) => {
		let currentPopout, currentProfile;

		const TextBelowName = class extends BdApi.React.Component {
			render() {
				const {plugin, userId} = this.props;
				const text = plugin ? plugin.formatLastSeen(userId) : "";
				return BDFDB.ReactUtils.createElement("section", {
					className: `${BDFDB.disCN.userprofilesection} lastonline-text-section`,
					children: [
						BDFDB.ReactUtils.createElement(BDFDB.LibraryComponents.Heading, {
							className: BDFDB.disCN.userprofilesectionheading,
							variant: "text-xs/semibold",
							style: {color: "var(--header-secondary)"},
							children: TEXTS.label
						}),
						BDFDB.ReactUtils.createElement(BDFDB.LibraryComponents.TextElement, {
							size: BDFDB.LibraryComponents.TextElement.Sizes.SIZE_14,
							className: "lastonline-text",
							children: text
						})
					]
				});
			}
		};

		return class LastOnline extends Plugin {
			onLoad() {
				currentPopout = null;
				currentProfile = null;
				this.RelationshipStore = BDFDB.LibraryStores.RelationshipStore;
				this.PresenceStore = BDFDB.LibraryStores.PresenceStore;
				this.Dispatcher = BDFDB.LibraryModules.Dispatcher;
				this.lastSeen = {};
				this.subscriptions = [];
				this.formatter = null;
				this.ensureFormatter();

				this.defaults = {
					places: {
						userPopout: {value: true, description: "User Popouts"},
						userProfile: {value: true, description: "User Profile Modal"}
					}
				};

				this.patchPriority = 9;
				this.modulePatches = {
					before: ["UserThemeContainer"],
					after: ["UserHeaderUsername", "UserProfile", "UserProfileInfoSection"]
				};

				this.css = `
.lastonline-text-section {
	margin-top: 4px;
	padding-top: 2px;
}

.lastonline-text {
	color: var(--text-normal);
	font-weight: 600;
}`;
			}

			onStart() {
				this.bootstrapStatuses();
				this.subscribe();
				BDFDB.PatchUtils.forceAllUpdates(this);
			}

			onStop() {
				this.unsubscribe();
				this.lastSeen = {};
				BDFDB.PatchUtils.forceAllUpdates(this);
			}

			getSettingsPanel(collapseStates = {}) {
				return BDFDB.PluginUtils.createSettingsPanel(this, {
					collapseStates,
					children: () => BDFDB.ReactUtils.createElement(BDFDB.LibraryComponents.SettingsPanelList, {
						title: "Показывать текст в:",
						children: Object.keys(this.defaults.places).map(key => BDFDB.ReactUtils.createElement(BDFDB.LibraryComponents.SettingsSaveItem, {
							type: "Switch",
							plugin: this,
							keys: ["places", key],
							label: this.defaults.places[key].description,
							value: this.settings.places[key]
						}))
					})
				});
			}

			processUserThemeContainer(e) {
				const props = e.instance.props.value || e.instance.props;
				if (props.layout == BDFDB.DiscordConstants.ProfileTypes.POPOUT) currentPopout = {props};
				if (props.layout == BDFDB.DiscordConstants.ProfileTypes.MODAL || props.layout == BDFDB.DiscordConstants.ProfileTypes.MODAL_V2) currentProfile = {props};
			}

			processUserHeaderUsername(e) {
				const themeType = BDFDB.ObjectUtils.get(e.instance, "props.tags.props.themeType");
				if (!this.settings.places.userPopout || !currentPopout || themeType != BDFDB.DiscordConstants.ProfileTypes.SIDEBAR && themeType != BDFDB.DiscordConstants.ProfileTypes.POPOUT) return;
				const user = e.instance.props.user || BDFDB.LibraryStores.UserStore.getUser(e.instance.props.userId);
				if (!user || user.isNonUserBot() || !this.isFriend(user.id)) return;
				e.returnvalue = [e.returnvalue].flat(10);
				e.returnvalue.push(BDFDB.ReactUtils.createElement(TextBelowName, {
					isInPopout: true,
					plugin: this,
					userId: user.id
				}, true));
			}

			processUserProfile(e) {
				if (!this.settings.places.userProfile || !currentProfile || e.instance.props.themeType != BDFDB.DiscordConstants.ProfileTypes.MODAL_V2) return;
				const user = currentProfile.props.user || BDFDB.LibraryStores.UserStore.getUser(currentProfile.props.userId);
				if (!user || user.isNonUserBot() || !this.isFriend(user.id)) return;
				const [children, index] = BDFDB.ReactUtils.findParent(e.returnvalue, {props: [["heading", BDFDB.LanguageUtils.LanguageStrings.MEMBER_SINCE_PLACEHOLDER]]});
				if (index > -1) children.splice(index, 0, BDFDB.ReactUtils.createElement(TextBelowName, {
					isInPopout: false,
					plugin: this,
					userId: user.id
				}, true));
			}

			processUserProfileInfoSection(e) {
				if (!this.settings.places.userProfile || !currentProfile) return;
				const user = e.instance.props.user || BDFDB.LibraryStores.UserStore.getUser(e.instance.props.userId);
				if (!user || user.isNonUserBot() || !this.isFriend(user.id)) return;
				const [children, index] = BDFDB.ReactUtils.findParent(e.returnvalue, {props: [["heading", BDFDB.LanguageUtils.LanguageStrings.MEMBER_SINCE_PLACEHOLDER]]});
				if (index > -1) children.splice(index, 0, BDFDB.ReactUtils.createElement(TextBelowName, {
					isInPopout: false,
					plugin: this,
					userId: user.id
				}, true));
			}

			isFriend(userId) {
				if (!userId || !this.RelationshipStore) return false;
				if (typeof this.RelationshipStore.isFriend === "function") return this.RelationshipStore.isFriend(userId);

				const friendType = BDFDB.DiscordConstants.RelationshipTypes?.FRIEND ?? 1;
				const rel = this.RelationshipStore.getRelationship?.(userId);
				if (rel !== undefined) return rel === friendType;

				const rels = this.RelationshipStore.getRelationships?.();
				if (rels && rels[userId] !== undefined) return rels[userId] === friendType;

				const ids = this.RelationshipStore.getFriendIDs?.();
				return Array.isArray(ids) ? ids.includes(userId) : false;
			}

			getStatus(userId) {
				if (!userId) return null;
				if (this.PresenceStore?.getStatus) return this.PresenceStore.getStatus(userId);
				if (BDFDB.UserUtils?.getStatus) return BDFDB.UserUtils.getStatus(userId);
				return null;
			}

			formatLastSeen(userId) {
				const status = this.getStatus(userId);
				if (status && status !== "offline" && status !== "invisible") {
					this.updateLastSeen(userId, Date.now());
					return TEXTS.online;
				}

				const ts = this.lastSeen[userId];
				if (!ts) return TEXTS.noData;

				const diff = Math.max(0, Date.now() - ts);
				if (diff < 30 * 1000) return TEXTS.justNow;

				const units = [
					["year", 1000 * 60 * 60 * 24 * 365],
					["month", 1000 * 60 * 60 * 24 * 30],
					["week", 1000 * 60 * 60 * 24 * 7],
					["day", 1000 * 60 * 60 * 24],
					["hour", 1000 * 60 * 60],
					["minute", 1000 * 60],
					["second", 1000]
				];

				for (const [unit, ms] of units) {
					const value = Math.floor(diff / ms);
					if (value >= 1) return this.formatRelative(-value, unit);
				}

				return this.formatRelative(-Math.round(diff / 1000), "second");
			}

			formatRelative(value, unit) {
				if (this.formatter) return this.formatter.format(value, unit);
				const short = {year: "y", month: "mo", week: "w", day: "d", hour: "h", minute: "m", second: "s"};
				return `${Math.abs(value)}${short[unit] || unit} ${TEXTS.ago}`;
			}

			updateLastSeen(userId, ts = Date.now()) {
				if (!userId) return;
				this.lastSeen[userId] = ts;
			}

			ensureFormatter() {
				try {
					this.formatter = new Intl.RelativeTimeFormat(DEFAULT_LOCALE, {numeric: "auto", style: "short"});
				} catch {
					this.formatter = null;
				}
			}

			bootstrapStatuses() {
				if (!this.RelationshipStore) return;
				const rels = this.RelationshipStore.getRelationships?.() || {};
				const friendType = BDFDB.DiscordConstants.RelationshipTypes?.FRIEND ?? 1;
				const now = Date.now();
				for (const [userId, type] of Object.entries(rels)) {
					if (type !== friendType) continue;
					const status = this.getStatus(userId);
					if (status && status !== "offline" && status !== "invisible") this.lastSeen[userId] = now;
				}
			}

			subscribe() {
				if (!this.Dispatcher) return;
				const presenceHandler = payload => {
					const updates = payload?.updates ?? [payload];
					for (const update of updates) this.processPresence(update);
				};

				const relationshipRemoved = payload => {
					const userId = payload?.id ?? payload?.userId ?? payload?.user?.id;
					if (!userId) return;
					if (this.isFriend(userId)) return;
					if (this.lastSeen[userId]) {
						delete this.lastSeen[userId];
					}
				};

				this.Dispatcher.subscribe("PRESENCE_UPDATES", presenceHandler);
				this.Dispatcher.subscribe("PRESENCE_UPDATE", presenceHandler);
				this.Dispatcher.subscribe("RELATIONSHIP_REMOVE", relationshipRemoved);

				this.subscriptions.push(
					{type: "PRESENCE_UPDATES", fn: presenceHandler},
					{type: "PRESENCE_UPDATE", fn: presenceHandler},
					{type: "RELATIONSHIP_REMOVE", fn: relationshipRemoved}
				);
			}

			unsubscribe() {
				if (!this.Dispatcher || !this.subscriptions) return;
				for (const {type, fn} of this.subscriptions) {
					try {
						this.Dispatcher.unsubscribe(type, fn);
					} catch {
						// ignore
					}
				}
				this.subscriptions = [];
			}

			processPresence(update) {
				const userId = update?.user?.id ?? update?.userId ?? update?.id;
				if (!userId || !this.isFriend(userId)) return;

				const status = this.extractStatus(update);
				if (!status) return;

				const now = Date.now();
				if (status === "offline" || status === "invisible") {
					this.updateLastSeen(userId, now);
					BDFDB.PatchUtils.forceAllUpdates(this);
					return;
				}

				this.updateLastSeen(userId, now);
				BDFDB.PatchUtils.forceAllUpdates(this);
			}

			extractStatus(update) {
				if (update?.status) return update.status;
				if (update?.clientStatus) return update.clientStatus.desktop || update.clientStatus.web || update.clientStatus.mobile;
				return null;
			}
		};
	})(window.BDFDB_Global.PluginUtils.buildPlugin(changeLog));
})();
