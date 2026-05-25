import "../../../assets/fonts/fonts.css";
import { CSSProperties, useEffect, useRef, useState } from "react";
import type { FC } from "react";
import { crawlAccountType, HistoryDataType } from "../data";
import { Button, Form, Layout, message, Space, Tag, Typography } from "antd";
import { ProForm, ProFormDateRangePicker, ProFormText, ProList } from "@ant-design/pro-components";
import {
  CLEAR_HISTORY,
  COLLECTING_STATE,
  EXPORT_RUN,
  HISTORY,
  HISTORY_REFRESH_TS,
  LATEST_COLLECTED_TRACE,
  START_COLLECTION,
  STOP_COLLECTION,
} from "../../consts";
import { sendRuntimeMessage } from "../../../utils/runtime";
import { DownloadOutlined, GithubOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { appFontFamily, brandColors } from "../../../theme/yellowTheme";

const { Content } = Layout;

const GH_STYLE = `
  @keyframes gh-float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-4px); }
  }
  .gh-btn { animation: gh-float 3s ease-in-out infinite; transition: color 0.2s, transform 0.15s; }
  .gh-btn:hover { animation: none !important; transform: scale(1.12); }
`;

const COLLECTING_QUIPS = [
  "Shh... sneaking past the algorithm...",
  "Counting likes so you don't have to...",
  "Teaching a robot to scroll so I don't have to...",
  "Harvesting the chronological timeline...",
  "One scroll to rule them all...",
  "The data must flow...",
  "Befriending the Instagram API...",
  "In stealth mode. Do not disturb.",
  "Scrolling into the void...",
  "Your data is being kidnapped. Politely.",
];

const sectionStyle: CSSProperties = {
  background: brandColors.surface,
  border: `1px solid ${brandColors.border}`,
  borderRadius: 18,
  boxShadow: brandColors.glow,
};

const MainPage: FC = () => {
  const [historyData, setHistoryData] = useState<HistoryDataType[]>([]);
  const [isCollecting, setIsCollecting] = useState<boolean>(false);
  const [quip, setQuip] = useState("");
  const quipTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    if (isCollecting) {
      const pick = () => COLLECTING_QUIPS[Math.floor(Math.random() * COLLECTING_QUIPS.length)];
      setQuip(pick());
      quipTimer.current = setInterval(() => setQuip(pick()), 3000);
    } else {
      if (quipTimer.current) clearInterval(quipTimer.current);
      setQuip("");
    }
    return () => { if (quipTimer.current) clearInterval(quipTimer.current); };
  }, [isCollecting]);

  const onFormFinish = async (formData: {
    accountId: string;
    startTime?: string;
    endTime?: string;
  }) => {
    if (isCollecting) {
      await sendRuntimeMessage({ type: STOP_COLLECTION });
      setIsCollecting(false);
      return;
    }

    const { accountId, startTime, endTime } = formData;
    const startTimeValue = (startTime as unknown as { toISOString?: () => string })?.toISOString?.() ?? startTime;
    const endTimeValue = (endTime as unknown as { toISOString?: () => string })?.toISOString?.() ?? endTime;
    const latestCrawledTime = Date.now();

    await chrome.storage.local.set({
      [LATEST_COLLECTED_TRACE]: JSON.stringify({
        accountId,
        startDate: startTimeValue,
        endDate: endTimeValue,
        runId: latestCrawledTime,
      }),
    });

    await sendRuntimeMessage({
      type: START_COLLECTION,
      payload: {
        runId: latestCrawledTime,
        accountId,
        accountType: 1,
        startTime: startTimeValue,
        endTime: endTimeValue,
      },
    });
    setIsCollecting(true);
  };

  const loadHistory = async () => {
    const data = await chrome.storage.local.get(HISTORY);
    const storedHistory = (data[HISTORY] || []) as HistoryDataType[];
    setHistoryData(storedHistory);

    const latest = storedHistory.length > 0 ? storedHistory[0] : null;
    if (!latest) return;
    form.setFieldsValue({
      accountId: latest.accountId,
      date: [latest.startTime, latest.endTime],
    });
  };

  const init = async () => {
    const collectingState = await chrome.storage.local.get(COLLECTING_STATE);
    const stored = collectingState[COLLECTING_STATE] as { isCollecting?: boolean } | undefined;
    if (typeof stored?.isCollecting === "boolean") {
      setIsCollecting(stored.isCollecting);
    }

    const storedHistory = await chrome.storage.local.get(LATEST_COLLECTED_TRACE);
    const latestCollectedAccount = storedHistory[LATEST_COLLECTED_TRACE] as string | undefined;
    if (latestCollectedAccount) {
      try {
        const parsedAccount: crawlAccountType = JSON.parse(latestCollectedAccount);
        form.setFieldsValue({
          accountId: parsedAccount.accountId,
          date: [parsedAccount.startDate, parsedAccount.endDate],
        });
      } catch (e) {}
    }

    await loadHistory();
  };

  const openPreview = async (row: HistoryDataType) => {
    if (!row?.runId) return;
    const url = chrome.runtime.getURL(`viewer.html?runId=${encodeURIComponent(String(row.runId))}`);
    await chrome.tabs.create({ url });
  };

  useEffect(() => {
    init();

    const onMessage = (msg: { type?: string }) => {
      if (msg?.type === STOP_COLLECTION) {
        setIsCollecting(false);
        loadHistory();
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);

    const onStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName !== "local") return;
      if (changes[COLLECTING_STATE]) {
        const next = changes[COLLECTING_STATE].newValue as { isCollecting?: boolean } | undefined;
        if (typeof next?.isCollecting === "boolean") {
          setIsCollecting(next.isCollecting);
        }
      }
      if (changes[HISTORY_REFRESH_TS]) {
        loadHistory();
      }
    };
    chrome.storage.onChanged.addListener(onStorageChange);

    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.storage.onChanged.removeListener(onStorageChange);
    };
  }, []);

  return (
    <Layout style={{ minHeight: "100vh", background: brandColors.background }}>
      <Content
        style={{
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          fontFamily: appFontFamily,
        }}
      >
        <div
          style={{
            ...sectionStyle,
            padding: "18px 18px 16px",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <Typography.Text
              style={{
                color: brandColors.primary,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontFamily: appFontFamily,
              }}
            >
              {chrome.i18n.getMessage("appName")}
            </Typography.Text>
            <Typography.Title
              level={4}
              style={{
                margin: "6px 0 4px",
                color: brandColors.text,
                fontFamily: appFontFamily,
                letterSpacing: "-0.03em",
              }}
            >
              {chrome.i18n.getMessage("workspaceHeadlineLabel")}
            </Typography.Title>
            <Typography.Paragraph
              style={{
                marginBottom: 10,
                color: brandColors.textMuted,
                fontFamily: appFontFamily,
              }}
            >
              {chrome.i18n.getMessage("extDesc")}
            </Typography.Paragraph>
            <Space size={8} wrap>
              <Tag
                style={{
                  borderRadius: 999,
                  padding: "4px 10px",
                  background: brandColors.backgroundSoft,
                  border: `1px solid ${brandColors.border}`,
                  color: brandColors.primary,
                  fontFamily: appFontFamily,
                }}
              >
                {chrome.i18n.getMessage("platformLabel")} · {chrome.i18n.getMessage("PlatfromIns")}
              </Tag>
            </Space>
          </div>

          <div style={{ flexShrink: 0 }}>
            <style>{GH_STYLE}</style>
            <a
              className="gh-btn"
              href="https://github.com/Syueying/PostRay"
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                color: brandColors.textMuted,
                fontSize: 13,
                fontFamily: appFontFamily,
                textDecoration: "none",
                fontWeight: 500,
              }}
            >
              <GithubOutlined style={{ fontSize: 16 }} />
              GitHub
            </a>
          </div>
        </div>

        <div style={{ ...sectionStyle, padding: 18 }}>
          <Typography.Title
            level={5}
            style={{ margin: 0, color: brandColors.text, fontFamily: appFontFamily }}
          >
            {chrome.i18n.getMessage("collectionSetupLabel")}
          </Typography.Title>
          <Typography.Paragraph
            style={{
              marginTop: 6,
              marginBottom: 16,
              color: brandColors.textMuted,
              fontFamily: appFontFamily,
            }}
          >
            {chrome.i18n.getMessage("accountIdFiledPlaceholder")}
          </Typography.Paragraph>

          <ProForm
            form={form}
            initialValues={{}}
            style={{ fontFamily: appFontFamily }}
            size="middle"
            onFinish={onFormFinish}
            layout="vertical"
            submitter={{
              resetButtonProps: { style: { display: "none" } },
              render: (props) => [
                <Button
                  style={{ width: "100%", height: 44, fontFamily: appFontFamily, fontWeight: 700 }}
                  type="primary"
                  key="submit"
                  onClick={() => props.form?.submit?.()}
                >
                  {isCollecting
                    ? chrome.i18n.getMessage("cancelCollectingLabel")
                    : chrome.i18n.getMessage("startCollectingLabel")}
                </Button>,
              ],
            }}
          >
            <ProFormText
              colProps={{ span: 24 }}
              required
              name="accountId"
              width="xl"
              label={
                <span style={{ fontFamily: appFontFamily, color: brandColors.text }}>
                  {chrome.i18n.getMessage("accountIdFiledLabel")}
                </span>
              }
              placeholder=""
              allowClear
              rules={[{ required: true, message: chrome.i18n.getMessage("alertNoAccountId") }]}
              fieldProps={{
                style: { width: "100%", maxWidth: "100%", fontFamily: appFontFamily },
                disabled: isCollecting,
              }}
            />

            <ProFormDateRangePicker
              label={
                <span style={{ fontFamily: appFontFamily, color: brandColors.text }}>
                  {chrome.i18n.getMessage("dateLaFieldLabel")}
                </span>
              }
              width="xl"
              fieldProps={{
                style: { marginBottom: 0, width: "100%", maxWidth: "100%", fontFamily: appFontFamily },
                disabled: isCollecting,
                disabledDate: (current) => current && current > dayjs().endOf("day"),
              }}
              transform={(values) => {
                return {
                  startTime: values ? values[0] : undefined,
                  endTime: values ? values[1] : undefined,
                };
              }}
              name="date"
              placeholder={["", ""]}
              rules={[{ required: true, message: chrome.i18n.getMessage("alertNoDateRange") }]}
            />
          </ProForm>

          {isCollecting && quip && (
            <Typography.Text
              style={{
                display: "block",
                textAlign: "center",
                marginTop: 10,
                color: brandColors.textMuted,
                fontSize: 12,
                fontStyle: "italic",
                fontFamily: appFontFamily,
              }}
            >
              {quip}
            </Typography.Text>
          )}
        </div>

        <div
          style={{
            ...sectionStyle,
            padding: 18,
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <Typography.Title
                level={5}
                style={{ margin: 0, color: brandColors.text, fontFamily: appFontFamily }}
              >
                {chrome.i18n.getMessage("historyLabel")}
              </Typography.Title>
              <Typography.Text
                style={{ color: brandColors.textMuted, fontFamily: appFontFamily }}
              >
                {chrome.i18n.getMessage("totalLabel")}: {historyData.length}
              </Typography.Text>
            </div>

            {historyData.length > 0 ? (
              <Button
                type="default"
                onClick={async () => {
                  if (!window.confirm(chrome.i18n.getMessage("clearConfirmLabel"))) return;
                  await sendRuntimeMessage({ type: CLEAR_HISTORY });
                  setHistoryData([]);
                }}
              >
                {chrome.i18n.getMessage("clearLabel")}
              </Button>
            ) : null}
          </div>

          <div style={{ flex: 1, minHeight: 0 }}>
            <ProList<HistoryDataType>
              rowKey="id"
              dataSource={historyData}
              showActions="hover"
              onDataSourceChange={setHistoryData}
              locale={{ emptyText: "Your data vault is empty. Time to harvest. 🌾" }}
              onRow={(record) => ({
                onClick: () => openPreview(record),
                style: { cursor: "pointer" },
                title: chrome.i18n.getMessage("previewLabel"),
              })}
              metas={{
                title: {
                  render: (_dom, row) => {
                    const titleText = `${row.accountId}${row.startTime ? ` · ${row.startTime}` : ""}${row.endTime ? ` → ${row.endTime}` : ""}`;
                    return (
                      <div>
                        <Typography.Text
                          strong
                          style={{
                            fontFamily: appFontFamily,
                            fontSize: 15,
                            color: brandColors.text,
                          }}
                        >
                          {titleText}
                        </Typography.Text>
                      </div>
                    );
                  },
                },
                description: {
                  render: (_dom, row) => {
                    const ms = row.runId < 1e12 ? row.runId * 1000 : row.runId;
                    const localTime = new Date(ms).toLocaleString();
                    return (
                      <Space size={8} wrap>
                        <Tag
                          style={{
                            borderRadius: 999,
                            background: brandColors.backgroundSoft,
                            border: `1px solid ${brandColors.border}`,
                            color: brandColors.primary,
                            fontFamily: appFontFamily,
                          }}
                        >
                          {chrome.i18n.getMessage("PlatfromIns")}
                        </Tag>
                        <Typography.Text
                          style={{ fontSize: 13, color: brandColors.textMuted, fontFamily: appFontFamily }}
                        >
                          {localTime}
                        </Typography.Text>
                      </Space>
                    );
                  },
                },
                actions: {
                  render: (_dom, row) => [
                    <Button
                      type="text"
                      size="small"
                      icon={<DownloadOutlined />}
                      onClick={async (event) => {
                        event?.stopPropagation?.();
                        if (!row?.runId) return;
                        await sendRuntimeMessage({
                          type: EXPORT_RUN,
                          payload: { runId: row.runId },
                        });
                        message.success("Data acquired. Use it wisely. 🕵️");
                      }}
                    >
                      {chrome.i18n.getMessage("exportLabel")}
                    </Button>,
                  ],
                },
              }}
            />
          </div>
        </div>
      </Content>
    </Layout>
  );
};

export default MainPage;
