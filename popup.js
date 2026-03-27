const signalRegexInput = document.querySelector("#signalRegex");
const signalRegexSection = document.querySelector("#signalRegexSection");
const assistantEnabledInput = document.querySelector("#assistantEnabled");
const profileSelect = document.querySelector("#profileSelect");
const profileFeatureSelect = document.querySelector("#profileFeature");
const featureDescription = document.querySelector("#featureDescription");
const addProfileButton = document.querySelector("#addProfileButton");
const deleteProfileButton = document.querySelector("#deleteProfileButton");
const statusText = document.querySelector("#status");
const saveButton = document.querySelector("#saveButton");
const resetButton = document.querySelector("#resetButton");
const REGEX_FLAGS_PATTERN = /^[dgimsuvy]*$/;
const DEFAULT_ASSISTANT_ENABLED = true;
const DEFAULT_PROFILE_ID = "lamp-control";
const DEFAULT_PROFILE_NAME = "LampControl";
const FEATURE_LAMP_SIGNAL_DIFF = "lamp-signal-diff";
const FEATURE_RESERVED = "reserved";
const DEFAULT_SIGNAL_REGEX = "([A-Za-z_][A-Za-z0-9_]*(?:\\s*\\/\\s*[A-Za-z_][A-Za-z0-9_]*)*)\\s*=+\\s*((?:0x[0-9A-Fa-f]+|\\d+)(?:\\s*\\/\\s*(?:0x[0-9A-Fa-f]+|\\d+))*)";

let popupState = {
  assistantEnabled: DEFAULT_ASSISTANT_ENABLED,
  profiles: createDefaultProfiles(),
  activeProfileId: DEFAULT_PROFILE_ID
};

function createDefaultProfile() {
  return {
    id: DEFAULT_PROFILE_ID,
    name: DEFAULT_PROFILE_NAME,
    feature: FEATURE_LAMP_SIGNAL_DIFF,
    signalRegex: DEFAULT_SIGNAL_REGEX
  };
}

function createDefaultProfiles() {
  return [createDefaultProfile()];
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.style.color = isError ? "#b91c1c" : "#4b5563";
}

function parseRegexLiteral(term) {
  if (!term.startsWith("/")) {
    return null;
  }

  const lastSlashIndex = term.lastIndexOf("/");

  if (lastSlashIndex <= 0) {
    return null;
  }

  const pattern = term.slice(1, lastSlashIndex);
  const flags = term.slice(lastSlashIndex + 1);

  if (!REGEX_FLAGS_PATTERN.test(flags)) {
    return null;
  }

  return { pattern, flags };
}

function normalizeFlags(flags) {
  return [...new Set(`${flags}g`)].join("");
}

function normalizeSignalRegexSource(value) {
  const normalizedValue = String(value ?? "").trim();
  return normalizedValue || DEFAULT_SIGNAL_REGEX;
}

function normalizeAssistantEnabled(value) {
  return value !== false;
}

function normalizeProfileName(value, index) {
  const normalizedValue = String(value ?? "").trim();
  return normalizedValue || `配置${index + 1}`;
}

function inferProfileFeature(profile) {
  const id = String(profile?.id ?? "").trim().toLowerCase();
  const name = String(profile?.name ?? "").trim().toLowerCase();

  if (id === DEFAULT_PROFILE_ID || name === DEFAULT_PROFILE_NAME.toLowerCase()) {
    return FEATURE_LAMP_SIGNAL_DIFF;
  }

  return FEATURE_RESERVED;
}

function normalizeProfileFeature(value, profile) {
  if (value === FEATURE_LAMP_SIGNAL_DIFF || value === FEATURE_RESERVED) {
    return value;
  }

  return inferProfileFeature(profile);
}

function normalizeProfiles(value) {
  if (!Array.isArray(value) || !value.length) {
    return createDefaultProfiles();
  }

  const profiles = [];
  const usedIds = new Set();

  for (const [index, profile] of value.entries()) {
    const baseId = String(profile?.id ?? "").trim() || `profile-${index + 1}`;
    let id = baseId;
    let suffix = 2;

    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }

    usedIds.add(id);
    profiles.push({
      id,
      name: normalizeProfileName(profile?.name, index),
      feature: normalizeProfileFeature(profile?.feature, profile),
      signalRegex: normalizeSignalRegexSource(profile?.signalRegex)
    });
  }

  return profiles.length ? profiles : createDefaultProfiles();
}

function resolveActiveProfileId(profiles, activeProfileId) {
  const normalizedId = String(activeProfileId ?? "").trim();

  if (profiles.some((profile) => profile.id === normalizedId)) {
    return normalizedId;
  }

  return profiles[0].id;
}

function getActiveProfile() {
  return popupState.profiles.find((profile) => profile.id === popupState.activeProfileId) || popupState.profiles[0];
}

function isLampSignalProfile(profile) {
  return profile.feature === FEATURE_LAMP_SIGNAL_DIFF;
}

function renderActiveProfile() {
  const activeProfile = getActiveProfile();
  const isLampProfile = isLampSignalProfile(activeProfile);

  profileSelect.value = activeProfile.id;
  profileFeatureSelect.value = activeProfile.feature;
  signalRegexInput.value = activeProfile.signalRegex;
  signalRegexSection.hidden = !isLampProfile;
  saveButton.disabled = !isLampProfile;
  resetButton.disabled = !isLampProfile;
  deleteProfileButton.disabled = popupState.profiles.length <= 1;
  featureDescription.textContent = isLampProfile
    ? "这个配置会启用灯控工步助手，并使用正则提取当前工步中变化的信号值。"
    : "这个配置目前只是独立入口位，不会使用 LampControl 的正则提取逻辑，后面可以扩展成其他测试用例专属功能。";
}

function renderProfiles() {
  profileSelect.replaceChildren();

  for (const profile of popupState.profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    profileSelect.append(option);
  }

  popupState.activeProfileId = resolveActiveProfileId(popupState.profiles, popupState.activeProfileId);
  renderActiveProfile();
}

function createProfileId(name) {
  const baseId = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "profile";

  let id = baseId;
  let suffix = 2;

  while (popupState.profiles.some((profile) => profile.id === id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return id;
}

async function saveProfiles(statusMessage) {
  await chrome.storage.sync.set({
    polarionProfiles: popupState.profiles,
    polarionActiveProfileId: popupState.activeProfileId
  });

  renderProfiles();

  if (statusMessage) {
    setStatus(statusMessage);
  }
}

function validateSignalRegex(value) {
  const source = normalizeSignalRegexSource(value);
  const regexLiteral = parseRegexLiteral(source);
  const pattern = regexLiteral ? regexLiteral.pattern : source;
  const flags = normalizeFlags(regexLiteral ? regexLiteral.flags : "");

  try {
    new RegExp(pattern, flags);
  } catch (error) {
    throw new Error(`信号正则无效：${error.message}`);
  }

  return source;
}

async function loadConfig() {
  const {
    polarionAssistantEnabled = DEFAULT_ASSISTANT_ENABLED,
    polarionProfiles = createDefaultProfiles(),
    polarionActiveProfileId = DEFAULT_PROFILE_ID
  } = await chrome.storage.sync.get({
    polarionAssistantEnabled: DEFAULT_ASSISTANT_ENABLED,
    polarionProfiles: createDefaultProfiles(),
    polarionActiveProfileId: DEFAULT_PROFILE_ID
  });

  popupState.assistantEnabled = normalizeAssistantEnabled(polarionAssistantEnabled);
  popupState.profiles = normalizeProfiles(polarionProfiles);
  popupState.activeProfileId = resolveActiveProfileId(popupState.profiles, polarionActiveProfileId);

  assistantEnabledInput.checked = popupState.assistantEnabled;
  renderProfiles();
}

async function saveActiveProfile() {
  const activeProfile = getActiveProfile();

  if (!isLampSignalProfile(activeProfile)) {
    setStatus(`当前配置 ${activeProfile.name} 暂时没有需要保存的 LampControl 正则。`);
    return;
  }

  const source = validateSignalRegex(signalRegexInput.value);

  popupState.profiles = popupState.profiles.map((profile) => (
    profile.id === activeProfile.id
      ? { ...profile, signalRegex: source }
      : profile
  ));

  await saveProfiles(`已保存 ${activeProfile.name} 配置。`);
}

async function resetActiveProfile() {
  const activeProfile = getActiveProfile();

  if (!isLampSignalProfile(activeProfile)) {
    setStatus(`当前配置 ${activeProfile.name} 没有 LampControl 默认正则可恢复。`);
    return;
  }

  popupState.profiles = popupState.profiles.map((profile) => (
    profile.id === activeProfile.id
      ? { ...profile, signalRegex: DEFAULT_SIGNAL_REGEX }
      : profile
  ));

  await saveProfiles(`已恢复 ${activeProfile.name} 的默认正则。`);
}

async function setAssistantEnabled(value) {
  const enabled = normalizeAssistantEnabled(value);
  popupState.assistantEnabled = enabled;
  await chrome.storage.sync.set({ polarionAssistantEnabled: enabled });
  assistantEnabledInput.checked = enabled;
  setStatus(enabled ? "插件已开启。" : "插件已关闭。");
}

async function switchProfile(profileId) {
  popupState.activeProfileId = resolveActiveProfileId(popupState.profiles, profileId);
  await chrome.storage.sync.set({ polarionActiveProfileId: popupState.activeProfileId });
  renderProfiles();
  setStatus(`已切换到 ${getActiveProfile().name} 配置。`);
}

async function setActiveProfileFeature(feature) {
  const activeProfile = getActiveProfile();
  const normalizedFeature = normalizeProfileFeature(feature, activeProfile);

  popupState.profiles = popupState.profiles.map((profile) => (
    profile.id === activeProfile.id
      ? {
          ...profile,
          feature: normalizedFeature,
          signalRegex: normalizeSignalRegexSource(profile.signalRegex)
        }
      : profile
  ));

  await saveProfiles(
    normalizedFeature === FEATURE_LAMP_SIGNAL_DIFF
      ? `已将 ${activeProfile.name} 切换为 LampControl 信号提取配置。`
      : `已将 ${activeProfile.name} 切换为其他用例预留配置。`
  );
}

async function addProfile() {
  const rawName = window.prompt("请输入新的测试用例配置名称：", "");

  if (rawName === null) {
    return;
  }

  const name = rawName.trim();

  if (!name) {
    throw new Error("配置名称不能为空。");
  }

  const profile = {
    id: createProfileId(name),
    name,
    feature: FEATURE_RESERVED,
    signalRegex: DEFAULT_SIGNAL_REGEX
  };

  popupState.profiles = [...popupState.profiles, profile];
  popupState.activeProfileId = profile.id;
  await saveProfiles(`已新增 ${name} 配置。`);
}

async function deleteActiveProfile() {
  if (popupState.profiles.length <= 1) {
    throw new Error("至少保留一个配置。");
  }

  const activeProfile = getActiveProfile();

  if (!window.confirm(`确定删除配置“${activeProfile.name}”吗？`)) {
    return;
  }

  popupState.profiles = popupState.profiles.filter((profile) => profile.id !== activeProfile.id);
  popupState.activeProfileId = popupState.profiles[0].id;
  await saveProfiles(`已删除 ${activeProfile.name} 配置。`);
}

assistantEnabledInput.addEventListener("change", () => {
  setAssistantEnabled(assistantEnabledInput.checked).catch((error) => {
    setStatus(error.message || "开关更新失败，请稍后重试。", true);
  });
});

profileSelect.addEventListener("change", () => {
  switchProfile(profileSelect.value).catch((error) => {
    setStatus(error.message || "配置切换失败，请稍后重试。", true);
  });
});

profileFeatureSelect.addEventListener("change", () => {
  setActiveProfileFeature(profileFeatureSelect.value).catch((error) => {
    setStatus(error.message || "配置功能更新失败，请稍后重试。", true);
  });
});

addProfileButton.addEventListener("click", () => {
  addProfile().catch((error) => {
    setStatus(error.message || "新增配置失败，请稍后重试。", true);
  });
});

deleteProfileButton.addEventListener("click", () => {
  deleteActiveProfile().catch((error) => {
    setStatus(error.message || "删除配置失败，请稍后重试。", true);
  });
});

saveButton.addEventListener("click", () => {
  saveActiveProfile().catch((error) => {
    setStatus(error.message || "保存失败，请稍后重试。", true);
  });
});

resetButton.addEventListener("click", () => {
  resetActiveProfile().catch((error) => {
    setStatus(error.message || "恢复失败，请稍后重试。", true);
  });
});

loadConfig().catch(() => {
  setStatus("无法读取已保存的配置。", true);
});
