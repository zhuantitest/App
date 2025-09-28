// screens/NotificationScreen.js
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { fetchNotifications, deleteNotificationApi, clearAllNotificationsApi } from '../lib/api';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

function mapServerToUi(n) {
  const titleByType = {
    repayment: '分帳/還款通知',
    alert: '提醒',
    system: '系統訊息',
    monthly: '月結摘要',
  };
  return {
    id: n.id,
    type: n.type,
    title: titleByType[n.type] || '通知',
    body: n.message || '',
    createdAt: n.createdAt,
    groupName: n.groupName || undefined,
  };
}

const palette = {
  bg: '#FFFDE7',
  card: '#FFFFFF',
  cardBorder: '#F1E9B6',
  text: '#333',
  sub: '#666',
  mute: '#888',
  unreadBg: '#FFF8E1',
  unreadDot: '#FF6F00',
  btnGray: '#F2F2F2',
  danger: '#E53935',
};

const typeColors = {
  split: { icon: '#00897B', bar: '#80CBC4' },
  card: { icon: '#3949AB', bar: '#C5CAE9' },
  account: { icon: '#EF6C00', bar: '#FFE0B2' },
  record: { icon: '#546E7A', bar: '#CFD8DC' },
  system: { icon: '#757575', bar: '#E0E0E0' },
  group_settle: { icon: '#2E7D32', bar: '#C8E6C9' },
  repay_request: { icon: '#E65100', bar: '#FFE0B2' },
  repayment: { icon: '#00897B', bar: '#80CBC4' },
  alert: { icon: '#E65100', bar: '#FFE0B2' },
  monthly: { icon: '#3949AB', bar: '#C5CAE9' },
  default: { icon: '#5D4037', bar: '#D7CCC8' },
};

function iconByType(type) {
  switch (type) {
    case 'repayment': return 'cash-refund';
    case 'alert': return 'alert-circle-outline';
    case 'system': return 'cog-outline';
    case 'monthly': return 'calendar-month';
    case 'split': return 'account-multiple';
    case 'card': return 'credit-card-outline';
    case 'account': return 'wallet';
    case 'record': return 'file-document-outline';
    case 'group_settle': return 'check-circle-outline';
    case 'repay_request': return 'cash-refund';
    default: return 'bell-outline';
  }
}
function colorByType(type) {
  return typeColors[type] || typeColors.default;
}
function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString();
}

export default function NotificationScreen() {
  const [notifications, setNotifications] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const res = await fetchNotifications({ page: 1, limit: 50 });
        const list = (res?.notifications || []).map(mapServerToUi);
        setNotifications(list);
      })();
    }, [])
  );

  const data = useMemo(() => {
    return [...notifications].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [notifications]);

  const removeOne = async (id) => {
    await deleteNotificationApi(id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const clearAll = async () => {
    await clearAllNotificationsApi();
    setNotifications([]);
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    (async () => {
      const res = await fetchNotifications({ page: 1, limit: 50 });
      const list = (res?.notifications || []).map(mapServerToUi);
      setNotifications(list);
      setRefreshing(false);
    })();
  }, []);

  const renderItem = ({ item }) => {
    const colors = colorByType(item.type);
    return (
      <View style={[styles.card, { borderLeftColor: colors.bar }]}>
        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: colors.bar }]}>
            <MaterialCommunityIcons name={iconByType(item.type)} size={20} color={colors.icon} />
          </View>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
            {!!item.groupName && (
              <Text style={[styles.body, { fontStyle: 'italic' }]} numberOfLines={1}>
                群組：{item.groupName}
              </Text>
            )}
            <Text style={styles.body} numberOfLines={3}>{item.body}</Text>
            <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => removeOne(item.id)}>
            <MaterialCommunityIcons name="delete-outline" size={18} color={palette.text} />
            <Text style={styles.actionText}>刪除</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>推播通知</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.headerBtn} onPress={clearAll}>
            <MaterialCommunityIcons name="trash-can-outline" size={20} color={palette.text} />
            <Text style={styles.headerBtnText}>清空</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={data}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons name="bell-off-outline" size={36} color={palette.sub} />
            <Text style={{ marginTop: 8, color: palette.sub }}>目前沒有通知</Text>
          </View>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },

  header: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: palette.text },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  headerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: palette.btnGray,
  },
  headerBtnText: { fontSize: 12, marginLeft: 6, color: palette.text },

  card: {
    borderWidth: 1,
    borderColor: palette.cardBorder,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    backgroundColor: palette.card,
    borderLeftWidth: 6,
  },

  row: { flexDirection: 'row', alignItems: 'center' },
  iconBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },

  title: { fontSize: 15, color: palette.text },
  body: { color: palette.sub, marginTop: 2 },
  time: { color: palette.mute, marginTop: 4, fontSize: 12 },

  actions: { flexDirection: 'row', marginTop: 10 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: palette.btnGray,
  },
  actionText: { fontSize: 12, marginLeft: 6, color: palette.text },

  empty: { alignItems: 'center', marginTop: 60 },
});
