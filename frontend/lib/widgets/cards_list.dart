import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../cubits/cards_cubit.dart';

class CardsList extends StatelessWidget {
  const CardsList({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<CardsCubit, List<String>>(
      builder: (context, cards) {
        return LayoutBuilder(
          builder: (context, constraints) {
            if (constraints.maxWidth < 600) {
              return ListView.builder(
                itemCount: cards.length,
                itemBuilder: (context, index) {
                  return ListTile(
                    title: Text(cards[index]),
                  );
                },
              );
            } else {
              return SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: DataTable(
                  columns: const [
                    DataColumn(label: Text('Name')),
                    DataColumn(label: Text('Profile Picture')),
                  ],
                  rows: cards.map((card) {
                    return DataRow(
                      cells: [
                        DataCell(Text(card)),
                        DataCell(Container(
                          width: 50,
                          height: 50,
                          color: Colors.grey,
                        )),
                      ],
                    );
                  }).toList(),
                ),
              );
            }
          },
        );
      },
    );
  }
}
