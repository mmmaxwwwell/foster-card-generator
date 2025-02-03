import 'package:bloc/bloc.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;

class CardsCubit extends Cubit<List<String>> {
  CardsCubit() : super([]);

  // Method to add a new card (represented by its title)
  void addCard(String cardTitle) {
    final updatedCards = List<String>.from(state)..add(cardTitle);
    emit(updatedCards);
  }

  // Method to remove an existing card
  void removeCard(String cardTitle) {
    final updatedCards = List<String>.from(state)..remove(cardTitle);
    emit(updatedCards);
  }

  // Method to clear all cards
  void clearCards() {
    emit([]);
  }

  // New method to update cards from a get request to localhost:3000/cards
  Future<void> fetchCards() async {
    try {
      final response = await http.get(Uri.parse('http://localhost:3000/cards'));
      if (response.statusCode == 200) {
        final decoded = json.decode(response.body);
        if (decoded['success'] == true) {
          final List<dynamic> data = decoded['data'];
          final cards = data.map((item) => item.toString()).toList();
          emit(cards);
        } else {
          throw "Failed to fetch cards";
        }
      } else {
        throw "Failed to fetch cards";
      }
    } catch (e) {
      throw "Failed to fetch cards";
    }
  }
}
