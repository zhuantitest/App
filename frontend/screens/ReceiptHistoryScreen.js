// screens/ReceiptHistoryScreen.js
// 收據歷史瀏覽介面

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { receiptHistory, searchReceipts, getSimilarReceipts } from '../utils/receiptHistory';
import { formatYMDLocal } from '../utils/dateUtils';

export default function ReceiptHistoryScreen({ navigation }) {
  const [history, setHistory] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredHistory, setFilteredHistory] = useState([]);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    if (searchQuery.trim()) {
      const results = searchReceipts(searchQuery);
      setFilteredHistory(results);
    } else {
      setFilteredHistory(history);
    }
  }, [searchQuery, history]);

  const loadHistory = async () => {
    try {
      const allHistory = receiptHistory.getAllHistory();
      setHistory(allHistory);
      setFilteredHistory(allHistory);
    } catch (error) {
      console.error('載入收據歷史失敗:', error);
    }
  };

  const handleReceiptPress = (receipt) => {
    setSelectedReceipt(receipt);
    setDetailModalVisible(true);
  };

  const handleDeleteReceipt = async (receiptId) => {
    Alert.alert(
      '確認刪除',
      '確定要刪除這張收據嗎？此操作無法復原。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '刪除',
          style: 'destructive',
          onPress: async () => {
            try {
              await receiptHistory.deleteReceipt(receiptId);
              await loadHistory();
              Alert.alert('刪除成功');
            } catch (error) {
              console.error('刪除收據失敗:', error);
              Alert.alert('刪除失敗', '請稍後再試');
            }
          },
        },
      ]
    );
  };

  const handleReuseReceipt = (receipt) => {
    Alert.alert(
      '重複使用收據',
      '選擇要重複使用的項目',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '全部項目',
          onPress: () => {
            navigation.navigate('AddTransaction', {
              receiptItems: receipt.items.map(item => ({
                name: item.name,
                price: item.amount,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                category: item.category,
                checked: true,
              })),
            });
          },
        },
        {
          text: '選擇項目',
          onPress: () => {
            // 這裡可以導航到選擇介面
            navigation.navigate('ReceiptItemSelector', { receipt });
          },
        },
      ]
    );
  };

  const renderReceiptItem = ({ item }) => (
    <TouchableOpacity
      style={styles.receiptItem}
      onPress={() => handleReceiptPress(item)}
      activeOpacity={0.8}
    >
      <View style={styles.receiptHeader}>
        <Text style={styles.vendorName}>{item.vendor}</Text>
        <Text style={styles.receiptDate}>{formatYMDLocal(new Date(item.date))}</Text>
      </View>
      
      <View style={styles.receiptDetails}>
        <Text style={styles.itemCount}>{item.items.length} 個項目</Text>
        <Text style={styles.totalAmount}>NT$ {item.total.toLocaleString()}</Text>
      </View>

      <View style={styles.receiptActions}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => handleReuseReceipt(item)}
        >
          <MaterialCommunityIcons name="reload" size={16} color="#2F80ED" />
          <Text style={styles.actionText}>重複使用</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.actionButton, styles.deleteButton]}
          onPress={() => handleDeleteReceipt(item.id)}
        >
          <MaterialCommunityIcons name="delete" size={16} color="#E74C3C" />
          <Text style={[styles.actionText, styles.deleteText]}>刪除</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  const renderDetailModal = () => (
    <Modal
      visible={detailModalVisible}
      animationType="slide"
      transparent
      onRequestClose={() => setDetailModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>收據詳情</Text>
            <TouchableOpacity
              onPress={() => setDetailModalVisible(false)}
              style={styles.closeButton}
            >
              <MaterialCommunityIcons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          {selectedReceipt && (
            <View style={styles.detailContent}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>商店：</Text>
                <Text style={styles.detailValue}>{selectedReceipt.vendor}</Text>
              </View>
              
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>日期：</Text>
                <Text style={styles.detailValue}>
                  {formatYMDLocal(new Date(selectedReceipt.date))}
                </Text>
              </View>
              
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>總金額：</Text>
                <Text style={styles.detailValue}>
                  NT$ {selectedReceipt.total.toLocaleString()}
                </Text>
              </View>

              <Text style={styles.itemsTitle}>商品明細：</Text>
              <FlatList
                data={selectedReceipt.items}
                keyExtractor={(item, index) => `${item.name}-${index}`}
                renderItem={({ item }) => (
                  <View style={styles.itemRow}>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <Text style={styles.itemCategory}>{item.category}</Text>
                    </View>
                    <View style={styles.itemPrice}>
                      <Text style={styles.itemQuantity}>x{item.quantity}</Text>
                      <Text style={styles.itemAmount}>NT$ {item.amount}</Text>
                    </View>
                  </View>
                )}
                style={styles.itemsList}
              />
            </View>
          )}

          <View style={styles.modalActions}>
            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => {
                setDetailModalVisible(false);
                if (selectedReceipt) {
                  handleReuseReceipt(selectedReceipt);
                }
              }}
            >
              <Text style={styles.modalButtonText}>重複使用</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>收據歷史</Text>
        <Text style={styles.subtitle}>
          共 {history.length} 張收據
        </Text>
      </View>

      <View style={styles.searchContainer}>
        <MaterialCommunityIcons name="magnify" size={20} color="#666" />
        <TextInput
          style={styles.searchInput}
          placeholder="搜尋商店名稱..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      <FlatList
        data={filteredHistory}
        keyExtractor={(item) => item.id}
        renderItem={renderReceiptItem}
        style={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <MaterialCommunityIcons name="receipt" size={64} color="#ccc" />
            <Text style={styles.emptyText}>
              {searchQuery ? '沒有找到符合的收據' : '還沒有收據記錄'}
            </Text>
          </View>
        }
      />

      {renderDetailModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    margin: 16,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    fontSize: 16,
  },
  list: {
    flex: 1,
  },
  receiptItem: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  receiptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  vendorName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  receiptDate: {
    fontSize: 14,
    color: '#666',
  },
  receiptDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  itemCount: {
    fontSize: 14,
    color: '#666',
  },
  totalAmount: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2F80ED',
  },
  receiptActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#f0f8ff',
  },
  deleteButton: {
    backgroundColor: '#fff5f5',
  },
  actionText: {
    fontSize: 12,
    color: '#2F80ED',
    marginLeft: 4,
  },
  deleteText: {
    color: '#E74C3C',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    marginTop: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  closeButton: {
    padding: 4,
  },
  detailContent: {
    padding: 20,
  },
  detailRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  detailLabel: {
    fontSize: 16,
    color: '#666',
    width: 80,
  },
  detailValue: {
    fontSize: 16,
    color: '#333',
    flex: 1,
  },
  itemsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginTop: 16,
    marginBottom: 12,
  },
  itemsList: {
    maxHeight: 300,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    color: '#333',
  },
  itemCategory: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  itemPrice: {
    alignItems: 'flex-end',
  },
  itemQuantity: {
    fontSize: 12,
    color: '#666',
  },
  itemAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  modalActions: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  modalButton: {
    backgroundColor: '#2F80ED',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
