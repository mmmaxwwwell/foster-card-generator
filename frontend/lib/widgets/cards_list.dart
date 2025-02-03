import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../cubits/cards_cubit.dart';

class CardsList extends StatelessWidget {
  const CardsList({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<CardsCubit, List<String>>(
      builder: (context, cards) {
        return ListView.builder(
          itemCount: cards.length,
          itemBuilder: (context, index) {
            return ListTile(
              title: Text(cards[index]),
            );
          },
        );
      },
    );
  }
}
